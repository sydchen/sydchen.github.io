+++
date = '2025-11-09T16:20:56+08:00'
draft = false
title = 'Mandelbrot Set 的 GPU 並行化優化'
+++

在[前一篇文章](../mandelbrot-simd-optimization/)中，我們使用 CPU SIMD（AVX-512）將 Mandelbrot Set 的計算從 285 ms 優化到 37.6 ms，獲得了 **7.6× 加速**。但這仍然局限於單執行緒內的向量化。

本文記錄如何將 Mandelbrot Set 移植到 GPU，逐步理解 GPU 的並行模型（SPMD、Warp、Occupancy），最終達到 **0.328 ms**，相比 CPU SIMD 版本獲得 **115× 加速**。

<!--more-->

## 從 SIMD 到 GPU

### CPU SIMD：單執行緒的資料並行

在 CPU SIMD 優化中，我們在**單一執行緒**內利用向量指令同時處理多個資料：

```cpp
// CPU SIMD (AVX-512): 顯式向量操作
__m512 x_vec = _mm512_setzero_ps();      // 明確建立 16-wide 向量
__m512 sum = _mm512_add_ps(x_vec, y_vec); // 顯式向量加法
__mmask16 mask = _mm512_cmp_ps_mask(...); // 手動管理 mask
```

### GPU：大規模的執行緒並行

GPU 的並行模型**完全不同**：

```cuda
// GPU SPMD: 看似 scalar 的程式碼
float x = 0.0f;       // 看起來是單一 float
float sum = x + y;    // 看起來是 scalar 加法
// 但實際上成千上萬個 threads 同時執行！
```

不是單執行緒的資料並行，而是大規模的執行緒並行，Kaggle NVIDIA P100 GPU 有 **3,584 個 CUDA cores**，可以同時運行 114,688 個 threads。
每個 thread 處理獨立的資料，而非打包成向量，硬體自動管理 masks 和控制流（透過 predication）。

### 核心差異：SIMD vs SPMD

| 特性 | CPU SIMD | GPU SPMD |
|------|----------|----------|
| **並行單位** | 資料（16 floats 打包成向量） | 執行緒（100,000+ 獨立執行緒） |
| **編程模型** | 顯式向量操作 (intrinsics) | SPMD (Single Program, Multiple Data) |
| **Mask 管理** | 程式設計師手動建立和更新 | 硬體自動管理 (predication) |
| **程式碼風格** | 顯式向量 intrinsics | Scalar 風格 |
| **典型加速** | 4-16× | 100-10,000× |
| **適用場景** | 單執行緒內的熱點迴圈 | 完全獨立的大規模計算 |

---

## 兩個GPU 版本的實作

我們將透過兩個逐步改進的實現，理解 GPU 並行化的思維模式。

---

### 版本一: 32 執行緒版本 (1×32) - 理解 SPMD

**核心想法**：「模仿 CPU SIMD，用 32 個 threads 做 32-wide 向量化」

```cuda
__global__ void mandelbrot_gpu_vector(
    uint32_t img_size,
    uint32_t max_iters,
    uint32_t *out
) {
    // 關鍵：threadIdx.x 區分不同的 thread
    uint32_t tid = threadIdx.x;  // 0, 1, 2, ..., 31

    // 每個 thread 處理若干行的部分列
    for (uint32_t i = 0; i < img_size; i++) {
        // 1D strided access:
        // Thread 0 處理 j=0, 32, 64, ...
        // Thread 1 處理 j=1, 33, 65, ...
        for (uint32_t j = tid; j < img_size; j += 32) {
            float cx = (float(j) / float(img_size)) * 2.5f - 2.0f;
            float cy = (float(i) / float(img_size)) * 2.5f - 1.25f;

            float x2 = 0.0f, y2 = 0.0f, w = 0.0f;
            uint32_t iters = 0;

            // 這個 while 看似 scalar，但 32 個 threads 同時執行！
            while (x2 + y2 <= 4.0f && iters < max_iters) {
                float x = x2 - y2 + cx;
                float y = w - x2 - y2 + cy;
                x2 = x * x;
                y2 = y * y;
                w = (x + y) * (x + y);
                ++iters;
            }

            out[i * img_size + j] = iters;
        }
    }
}

// 啟動：1 個 block，32 個 threads (1 個 warp)
mandelbrot_gpu_vector<<<1, 32>>>(...);
```

#### 資料分配模式

```
像素 index:  0  1  2  ... 31 | 32 33 34 ... 63 | 64 65 ...
處理 thread: T0 T1 T2 ... T31| T0 T1 T2 ... T31| T0 T1 ...
             └─────────────┘  └─────────────┘
                第 1 輪         第 2 輪
```

**結果（1024×1024 圖像）**：
```
GPU Vector (32 threads):  135.7 ms
CPU Vector (AVX-512 SIMD): 37.6 ms
```

比 CPU 向量版本慢，仍然嚴重欠利用 GPU（32 / 114,688 = **0.03%**）。每個 thread 要處理 32,768 個像素，無法充分利用並行性。

#### 關鍵概念 1: Warp - GPU 的執行單位

這個實驗引出了 GPU 的核心概念：**Warp**

- 1 個 warp = **32 個 threads**
- 這 32 個 threads **鎖步執行** (lock-step)
- 所有 threads 執行相同的指令，但操作不同的資料

**視覺化執行過程**：

```
時間軸:
┌───────────────────────────────────┐
│ 週期 1: 32 個 threads 同時計算 cx   │
│ 週期 2: 32 個 threads 同時計算 cy   │
│ 週期 3: 32 個 threads 同時計算 x2   │
│ 週期 4: 32 個 threads 同時計算 y2   │
│ ...                               │
└───────────────────────────────────┘

硬體層級 (簡化):
┌──────────────────────────────────┐
│ CUDA Core 0:  Thread 0 的計算    │
│ CUDA Core 1:  Thread 1 的計算    │ ← 同時執行相同指令
│ CUDA Core 2:  Thread 2 的計算    │    但處理不同資料
│ ...                             │
│ CUDA Core 31: Thread 31 的計算   │
└──────────────────────────────────┘
```

#### 關鍵概念 2: SPMD 程式模型

GPU 使用 **SPMD (Single Program, Multiple Data)** 模型：

- 寫一份看似 scalar 的程式
- 用 `threadIdx.x` 區分不同 thread
- 每個 thread 處理不同的資料
- 硬體自動將多個 threads 組成向量 (warp) 執行

**與 CPU SIMD 的對比**：

```cpp
// CPU SIMD: 顯式打包成向量
__m512 x_vec = _mm512_set_ps(x0, x1, ..., x15);  // 手動打包 16 個值
__m512 result = _mm512_mul_ps(x_vec, y_vec);  // 顯式向量乘法，同時計算 16 個值

// GPU SPMD: 看似 scalar
float x = ...;         // Thread 0 有自己的 x，Thread 1 有自己的 x，...
float result = x * y;  // 看起來是 scalar，但 32 個 threads 同時執行
```

#### 關鍵概念 3: 硬體 Predication

**問題**：不同 threads 的 while 條件不同，GPU 怎麼處理？

假設 warp 中的 3 個 threads：
- Thread 0: magnitude = 5.0 (已逃逸，應該停止)
- Thread 1: magnitude = 2.0 (未逃逸，應該繼續)
- Thread 2: magnitude = 3.5 (未逃逸，應該繼續)

```cuda
while (x2 + y2 <= 4.0f && iters < max_iters) {
    // GPU 硬體自動處理：
    // 1. 評估條件 → 產生內部 mask = {0, 1, 1, ...}
    //    (0 = inactive, 1 = active)
    //
    // 2. 所有 threads 執行指令（維持鎖步）
    //
    // 3. 但 Thread 0 的寫入被 mask 掉（硬體處理）
    //    Thread 0 執行但不寫入結果，Thread 1/2 正常寫入
    //
    // 4. 當所有 threads 都 inactive 時跳出迴圈

    iters++;
}
```

**GPU vs CPU 的 Mask 管理**：

| 特性 | CPU Vector | GPU Vector |
|------|-----------|-----------|
| **Mask 管理** | 程式設計師手動建立 `__mmask16` | 硬體自動管理 |
| **程式碼風格** | 顯式 `_mm512_mask_add_epi32()` | Scalar 風格 `iters++` |
| **控制流處理** | 手動 `vandq_u32()` 更新 mask | 硬體 predication |
| **提早終止** | 手動檢查 `if (mask == 0) break` | 硬體自動優化 |

**GPU 的優勢**：
- 程式設計師不需要明確管理 mask
- 程式碼看起來像 scalar，易讀易寫
- 硬體自動處理所有複雜的控制流

**代價**：
- Warp 內的 divergence 仍會造成浪費（慢的 thread 拖累快的 thread）

---

### 版本二: 正確的 2D 並行化

**正確想法**：「不要模仿 SIMD，而是創建大量獨立執行緒，每個處理最小工作單元」

#### 核心原則：每個像素 = 1 個執行緒

GPU 的最佳實踐是讓**每個執行緒處理最小的獨立工作單元**，對於圖像來說就是**1 個像素**。

#### 實現：2D Grid 映射

```cuda
__global__ void mandelbrot_gpu_parallel(
    uint32_t img_size,
    uint32_t max_iters,
    uint32_t *out
) {
    // 2D grid 映射：每個 thread 對應一個 (i, j) 座標
    uint32_t j = blockIdx.x * blockDim.x + threadIdx.x;  // 行 (column, x)
    uint32_t i = blockIdx.y * blockDim.y + threadIdx.y;  // 列 (row, y)

    // 邊界檢查（因為 grid 可能大於圖像）
    if (i >= img_size || j >= img_size) return;

    // 每個 thread 只計算一個像素
    float cx = (float(j) / float(img_size)) * 2.5f - 2.0f;
    float cy = (float(i) / float(img_size)) * 2.5f - 1.25f;

    float x2 = 0.0f, y2 = 0.0f, w = 0.0f;
    uint32_t iters = 0;

    while (x2 + y2 <= 4.0f && iters < max_iters) {
        float x = x2 - y2 + cx;
        float y = w - x2 - y2 + cy;
        x2 = x * x;
        y2 = y * y;
        w = (x + y) * (x + y);
        ++iters;
    }

    // 直接寫入對應位置
    out[i * img_size + j] = iters;
}
```

#### 啟動配置：2D Grid

CUDA 使用 2D/3D grid 來組織執行緒：

```cuda
void launch_mandelbrot_gpu_parallel(
    uint32_t img_size,
    uint32_t max_iters,
    uint32_t *out
) {
    // Block 大小：16×16 = 256 threads
    dim3 block(16, 16);

    // Grid 大小：計算需要多少個 blocks 來覆蓋整個圖像
    // 例如 1024×1024 圖像：(1024+15)/16 = 64 個 blocks (每個方向)
    dim3 grid((img_size + block.x - 1) / block.x,
              (img_size + block.y - 1) / block.y);

    // 啟動 kernel
    mandelbrot_gpu_parallel<<<grid, block>>>(img_size, max_iters, out);
}
```

**對於 1024×1024 圖像**：
```
Block: 16×16 = 256 threads/block
Grid:  64×64 = 4,096 blocks
總 threads: 256 × 4,096 = 1,048,576 threads

每個 thread 處理: 1 pixel
```

#### 視覺化：2D Grid 映射

```
圖像 (1024×1024)
┌─────────────────────────────────┐
│ Block(0,0)  Block(1,0)  ...     │  每個 Block = 16×16 pixels
│   ┌──┐        ┌──┐              │
│   └──┘        └──┘              │
│                                 │
│ Block(0,1)  Block(1,1)  ...     │
│   ┌──┐        ┌──┐              │
│   └──┘        └──┘              │
│                                 │
│  ...          ...        ...    │
└─────────────────────────────────┘

每個 Block 內部 (16×16 threads):
┌──────────────────┐
│ T₀₀ T₀₁ ... T₀₁₅ │ 每個 T = 1 thread = 1 pixel
│ T₁₀ T₁₁ ... T₁₁₅ │
│  ⋮   ⋮       ⋮    │
│ T₁₅₀ T₁₅₁...T₁₅₁₅│
└──────────────────┘

Thread (5, 3) 的座標計算:
i = blockIdx.y * blockDim.y + threadIdx.y = 0 * 16 + 5 = 5
j = blockIdx.x * blockDim.x + threadIdx.x = 0 * 16 + 3 = 3
→ 處理像素 (5, 3)
```

#### 為什麼 2D 映射更好？

| 特性 | 1D Strided (32 threads) | 2D Grid (1M threads) |
|------|------------------------|---------------------|
| **資料映射** | 不自然（跨步訪問） | 自然（直接映射） |
| **並行度** | 32 threads (0.03%) | 1,048,576 threads (100%) |
| **每 thread 工作** | 32,768 pixels | 1 pixel |
| **Memory Coalescing** | 較差 | 優秀 |
| **適用場景** | 教學示範 | 實際應用 |

---

## 實驗結果與分析

### 完整性能對比

#### 256×256 圖像

| 版本 | 時間 | Threads 配置 | 加速比 (vs 1 thread) |
|------|------|--------------|---------------------|
| GPU Scalar (1 thread) | 246.97 ms | 1 thread, 1 block | 1.0× (基準) |
| GPU Vector (32 threads) | 10.81 ms | 32 threads, 1 block | 22.8× |
| GPU Parallel (16×16) | 31.07 ms | 256 threads/block, 256 blocks | 7.9× |
| GPU Parallel (32×32) | **0.098 ms**  | 1024 threads/block, 64 blocks | **2,531×** |

#### 512×512 圖像

| 版本 | 時間 | Threads 配置 | 加速比 (vs 1 thread) |
|------|------|--------------|---------------------|
| GPU Scalar (1 thread) | 912.85 ms | 1 thread, 1 block | 1.0× (基準) |
| GPU Vector (32 threads) | 36.24 ms | 32 threads, 1 block | 25.2× |
| GPU Parallel (16×16) | **0.129 ms**  | 256 threads/block, 1024 blocks | **7,103×** |
| GPU Parallel (32×32) | **0.130 ms**  | 1024 threads/block, 256 blocks | **7,029×** |

#### 1024×1024 圖像

| 版本 | 時間 | Threads 配置 | 加速比 (vs 1 thread) |
|------|------|--------------|---------------------|
| GPU Scalar (1 thread) | 3,647 ms | 1 thread, 1 block | 1.0× (基準) |
| GPU Vector (32 threads) | 135.71 ms | 32 threads, 1 block | 26.9× |
| GPU Parallel (16×16) | **0.328 ms** | 256 threads/block, 4096 blocks | **11,107×** |
| GPU Parallel (32×32) | 0.377 ms | 1024 threads/block, 1024 blocks | 9,678× |

### 關鍵觀察

#### 1. 圖像尺寸對最佳配置的影響

| 圖像大小 | 最快版本 | 原因 |
|---------|---------|------|
| 256×256 (小) | **32×32 blocks** | 工作量小，最大並行度可攤銷 kernel launch overhead |
| 512×512 (中) | **16×16 和 32×32 相當** | 達到平衡點 |
| 1024×1024 (大) | **16×16 blocks** | Divergence 嚴重，更多小 blocks 提供更好的 load balancing |

#### 2. 意外：小圖像時 16×16 反而慢於 32 threads？

**256×256 圖像結果**：
- 32 threads: 10.81 ms
- 16×16 blocks: 31.07 ms  (慢了 3 倍)

**原因**：Kernel Launch Overhead

```
16×16 配置 (256×256 圖像):
- 需要啟動 256 個 blocks (16×16 grid)
- 每個 block 只有 256 threads
- 每個 thread 只處理 1 pixel
- Kernel launch 時間: ~數十微秒
→ Launch overhead 佔比太高，工作量無法攤銷

32 threads 配置:
- 只啟動 1 個 block (幾乎沒有 overhead)
- 每個 thread 處理 2,048 pixels
- 工作時間遠大於 launch 時間
→ 雖然並行度低，但 overhead 也低
```

#### 3. 意外：大圖像時 16×16 反而快於 32×32？

**1024×1024 圖像結果**：
- 16×16 blocks: **0.328 ms**
- 32×32 blocks: 0.377 ms (慢 15%)

**原因**：Control Flow Divergence + Load Balancing

Mandelbrot Set 的計算特性：
- 邊界點：需要 ~256 次迭代（接近 max_iters）
- 快速逃逸點：< 10 次迭代
- 計算時間差異：**25 倍**

```
32×32 blocks (1024 threads/block):
┌────────────────────────────────────┐
│ ████████ ........ ░░░░░░░░░░░░░░░░ │
│ ████████ ........ ░░░░░░░░░░░░░░░░ │  ← 同一個 block 內
│  ...                               │     包含快速和慢速像素
│ ████████ ........ ░░░░░░░░░░░░░░░░ │
└────────────────────────────────────┘
   快速           中等          慢速
→ Block 完成時間 = max(所有 threads)
→ 快速 threads 浪費時間等待慢速 threads

16×16 blocks (256 threads/block):
┌──────────┐ ┌──────────┐ ┌──────────┐
│ ████████ │ │ ░░░░░░░░ │ │ ████████ │ ← 更小的 block
│ ████████ │ │ ░░░░░░░░ │ │ ████████ │    分得更細
│ ████████ │ │ ░░░░░░░░ │ │ ████████ │
└──────────┘ └──────────┘ └──────────┘
   快速完成      慢速完成      快速完成
→ 更細緻的 workload 分配
→ 4096 個 blocks 提供更好的 load balancing
→ GPU 可以先執行完快速 blocks，再處理慢速 blocks
```

**Load Balancing 示意**：

```
時間軸 (32×32 blocks):
Block 0: ████████████████████████████ (慢，等最慢的 thread)
Block 1: █████ (快，但要等 Block 0)
  → 總時間 = 所有 blocks 的 max

時間軸 (16×16 blocks):
Block 0:  ████████████████████████████ (慢)
Block 1:  █████ (快，已完成)
Block 2:  █████ (快，已完成)
Block 3:  ████████████ (中等)
...       ← GPU 可以動態調度，先跑完快的
Block N:  ████████████████████████████ (慢)
  → 總時間 < 32×32，因為有更好的 load balancing
```

---

## 性能調優：Block Size 的選擇

### CUDA Block Size 的基本原則

1. **必須是 warp size (32) 的倍數**
   - 1D: 32, 64, 128, 256, 512, 1024
   - 2D: 8×8, 16×16, 32×32 (= 64, 256, 1024 threads)

2. **最大值是 1024 threads/block**
   - 這是硬體限制

3. **越大越好？不一定！**
   - 需要考慮 occupancy、divergence、load balancing

### Occupancy 計算

**NVIDIA P100 規格**：
- 56 個 SM (Streaming Multiprocessors)
- 每個 SM 最多 **2,048 個 resident threads**
- 每個 SM 最多 **32 個 active blocks**

```
Block size = 256 threads (16×16):
- 每個 SM 可容納: 2048 / 256 = 8 blocks
- Blocks 限制: 最多 32 blocks → 不受限
- 理論 occupancy: 100%

Block size = 1024 threads (32×32):
- 每個 SM 可容納: 2048 / 1024 = 2 blocks
- Blocks 限制: 最多 32 blocks → 不受限
- 理論 occupancy: 100%
```

**兩者 occupancy 都是 100%，但實際性能可能不同！**

原因：Occupancy 不是唯一因素，還有：
- Control flow divergence
- Load balancing
- Memory access patterns
- Register usage

### 實際選擇指南

| 場景 | 推薦 Block Size | 原因 |
|------|----------------|------|
| **均勻計算量** | 32×32 (1024) | 最大化並行度，減少 block 數量和 overhead |
| **計算量差異大** (如 Mandelbrot) | 16×16 (256) | 更好的 load balancing |
| **需要大量 shared memory** | 8×8 或 16×16 | 減少每個 block 的資源需求 |
| **小規模問題** | 視情況，可能 1 warp (32 threads) 更好 | 避免過多 block launch overhead |

### 我們的實驗驗證

```
小圖像 (256×256):
→ 32×32 獲勝 (0.098ms vs 31.07ms)
→ 原因: 工作量小，要最大化並行度來攤銷 overhead
→ 32 threads 版本因 overhead 更低反而比 16×16 快

大圖像 (1024×1024):
→ 16×16 獲勝 (0.328ms vs 0.377ms)
→ 原因: Divergence 嚴重，需要更細緻的 load balancing
→ 4096 個小 blocks 優於 1024 個大 blocks
```

---

## 總結與最佳實踐

**SPMD 的威力**：
- 寫起來像 scalar（易讀易寫）
- 執行起來是大規模並行（硬體自動優化）
- 硬體自動處理 masks 和 divergence（不需要手動管理）

**Load Balancing 的重要性**：
- Occupancy 100% 不等於性能最優
- Divergence 嚴重時，小 block 可能更好
- 永遠要實際測量！

### 參考資料

- [CUDA C Programming Guide](https://docs.nvidia.com/cuda/cuda-c-programming-guide/)
- [Parallel Thread Execution (PTX) ISA](https://docs.nvidia.com/cuda/parallel-thread-execution/)
- [CUDA Best Practices Guide](https://docs.nvidia.com/cuda/cuda-c-best-practices-guide/)

