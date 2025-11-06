+++
date = '2025-11-06T14:13:20+08:00'
draft = false
title = '從 Scalar 到 Vector：Mandelbrot 集合加速之旅'
tags = ['SIMD', 'C++', 'Mandelbrot']
+++

在現代計算機科學中，平行計算已經成為提升程式效能的關鍵技術。無論是處理海量資料、渲染複雜圖形，還是訓練深度學習模型，充分利用硬體的平行能力都能帶來數倍甚至數十倍的效能提升。

本文將透過一個經典的視覺化問題 —— **Mandelbrot 集合的繪製** —— 來深入探討如何將單執行緒的 scalar 程式逐步優化為高效的向量化程式。我們將涵蓋以下關鍵技術：

<!--more-->

- **SIMD (Single Instruction, Multiple Data)** 的基本概念
- **AVX-512** 指令集的實際應用
- **Predication Mask** 技術：處理控制流發散的關鍵

透過實際的程式碼範例和效能測試數據，你將學會如何運用這些技術來大幅提升程式效能。本文基於 MIT 6.S894 課程的 Lab 1，並整合了實際的實作經驗和測試結果。

---

## 什麼是 Mandelbrot 集合？

### 分形與複數迭代

[Mandelbrot 集合](https://zh.wikipedia.org/zh-tw/%E6%9B%BC%E5%BE%B7%E5%8D%9A%E9%9B%86%E5%90%88)是數學中最著名的**碎形**（fractal）之一，以數學家 Benoît Mandelbrot 的名字命名。
它在複數平面上呈現出無限複雜且自相似的圖案，即使放大任意倍數，仍能看到類似的結構。

從數學角度來看，Mandelbrot 集合定義為：對於複數平面上的每一個點 $c$（$c$ 為複數），考慮以下遞迴公式：

$$
z_{n+1} = z_n^² + c
$$

其中：
- $z$ 是複數（有實部和虛部）
- $c$ 是常數（代表像素的位置）
- 從 $z_0 = 0$ 開始迭代

$$
\begin{aligned}
z_0 &= 0 \\\\
z_{n+1} &= z_n^2 + c
\end{aligned}
$$

如果這個序列保持有界（不趨向無窮大），則點 $c$ 屬於 Mandelbrot 集合。實際計算中，我們檢查 $|z_n|^2 = x^2 + y^2$ 是否超過 4.0（逃逸半徑），如果超過則認為該點會趨向無窮。

### 轉換為程式碼

將複數運算展開為實數和虛數部分：

$$
\begin{aligned}
c &= c_x + c_y i \\\\
z &= x + yi \\\\
z^2 &= (x + yi)^2 = x^2 - y^2 + 2xyi \\\\
z_{n+1} &= z^2 + c = (x^2 - y^2 + c_x) + (2xy + c_y)i
\end{aligned}
$$

因此，每次迭代的計算可以寫成：

```cpp
// 對於複數平面上的點 (cx, cy)
float x = 0.0f, y = 0.0f;
int iters = 0;

while (x*x + y*y <= 4.0f && iters < max_iters) {
    float x_new = x*x - y*y + cx;
    float y_new = 2.0f * x * y + cy;
    x = x_new;
    y = y_new;
    iters++;
}

// iters 的值決定像素顏色
```

### 為什麼適合平行計算？

Mandelbrot 集合的計算具有以下特性，使其成為學習平行計算的理想範例：

1. **像素獨立性**：每個像素的計算完全獨立，不需要與其他像素交互
2. **計算密集**：每個像素可能需要數百次浮點運算，記憶體存取相對較少
3. **大規模資料**：1024×1024 的影像有超過 100 萬個像素需要處理
4. **控制流發散**：不同像素可能需要不同的迭代次數（這是向量化的主要挑戰！）

**控制流發散的挑戰**：

```
像素 A: 10 次迭代就逃逸  → 快速完成
像素 B: 256 次迭代才逃逸 → 需要更多時間
像素 C: 永不逃逸          → 達到最大迭代數
```

在向量化時，這些不同行為的像素可能會被放在同一個向量中，需要特殊技術來處理。

---

## Scalar 實作：建立基準線

在開始優化之前，我們需要一個基準實作來衡量改進的效果。Scalar 版本的核心邏輯很簡單：

### 核心迭代邏輯

```cpp
// 對每個像素執行 Mandelbrot 迭代
float x = 0.0f, y = 0.0f;
uint32_t iters = 0;

while (x*x + y*y <= 4.0f && iters < max_iters) {
    float x2 = x * x;
    float y2 = y * y;
    float w = 2.0f * x * y;

    x = x2 - y2 + cx;  // 實部: x² - y² + cx
    y = w + cy;        // 虛部: 2xy + cy
    iters++;
}
```

**關鍵點**：

- 每個像素獨立計算，雙層迴圈遍歷所有像素
- $x^2 + y^2 \leq 4.0$ 判斷是否逃逸（逃逸半徑為 2，平方後為 4）
- `iters` 記錄逃逸前的迭代次數，用於決定顏色

### 效能基準

在 Kaggle 上的實測結果(Intel® Xeon® CPU @ 2.00GHz)：

| 影像大小      | 迭代次數 | 執行時間          |
| --------- | ---- | ------------- |
| 256×256   | 128  | **28.45 ms**  |
| 512×512   | 256  | **116.35 ms** |
| 1024×1024 | 512  | **448.24 ms** |

### 為什麼需要優化？

觀察這些數據，我們發現：

1. **時間隨像素數量線性增長**：解析度翻倍，時間增加 4 倍
2. **每個像素都是獨立計算**：沒有利用任何平行性
3. **現代 CPU 的平行能力被浪費**：SIMD 單元閒置，只使用一個執行核心

這就是為什麼我們需要向量化！

---

## 向量化基礎：SIMD 概念

### 什麼是 SIMD？

**SIMD (Single Instruction, Multiple Data)** 是一種平行計算模式，其核心思想是：

> 用一條指令同時對多個資料執行相同的操作

**Scalar vs SIMD 對比**：

```cpp
// Scalar: 一次處理一個 float
float a = 1.0f, b = 2.0f;
float c = a + b;  // 一次加法

// SIMD (16-wide): 一次處理 16 個 floats
__m512 a_vec = _mm512_set1_ps(1.0f);  // {1.0, 1.0, ..., 1.0} (16個)
__m512 b_vec = _mm512_set1_ps(2.0f);  // {2.0, 2.0, ..., 2.0} (16個)
__m512 c_vec = _mm512_add_ps(a_vec, b_vec);  // 16 次加法同時執行！
```

### AVX-512：512-bit SIMD

**AVX-512** 是 x86-64 架構的進階 SIMD 指令集，廣泛應用於 Intel Xeon、高階桌面處理器等。

**核心特性**：

- 向量寬度：**512-bit**
- 可以容納：**16 個 float**（32-bit × 16）或 **16 個 uint32**
- 每條指令同時處理 16 個數據元素

**視覺化**：

```
AVX-512 向量 (512-bit):
┌────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────┐
│ f0 │ f1 │ f2 │ f3 │ f4 │ f5 │ f6 │ f7 │ f8 │ f9 │f10 │f11 │f12 │f13 │f14 │f15 │
└────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┴────┘
  ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓    ↓
              16 個 floats 同時處理（一條指令）
```

### 什麼是 Intrinsics（內建函數）？

**Intrinsics** 是 C/C++ 中直接對應 SIMD 指令的函數，讓我們能用「類似函數呼叫」的方式寫向量程式碼：

```
高階語言 (C++)  →  Intrinsics  →  組合語言 (Assembly)  →  機器碼
```

**為什麼需要 Intrinsics？**

```cpp
// 選項 1: 寫組合語言（太痛苦）
asm volatile (
    "vaddps %zmm0, %zmm1, %zmm2"  // 直接寫組合語言
);

// 選項 2: 使用 Intrinsics（推薦！）
__m512 result = _mm512_add_ps(a, b);  // 看起來像 C++，編譯成組合語言

// 選項 3: 依賴編譯器自動向量化（不可控）
for (int i = 0; i < 16; i++) {
    c[i] = a[i] + b[i];  // 希望編譯器幫我們向量化
}
```

**Intrinsics 的優勢**：

- 可讀性：看起來像 C++ 函數
- 可攜性：跨平台（只要 CPU 支援）
- 可控性：精確控制 SIMD 指令
- 效能：直接映射到硬體指令

---

### Scalar vs Vector：實際範例對比

讓我們用具體例子理解 scalar 和 vector 的差異：

#### 範例 1：加法運算

**Scalar 版本（傳統寫法）：**

```cpp
// 計算 16 個加法
float a[16] = {1.0f, 2.0f, 3.0f, ..., 16.0f};
float b[16] = {0.5f, 0.5f, 0.5f, ..., 0.5f};
float c[16];

for (int i = 0; i < 16; i++) {
    c[i] = a[i] + b[i];  // 執行 16 次
}

// 時間成本：16 條加法指令 = 16 個時鐘週期
```

**Vector 版本（AVX-512 intrinsics）：**

```cpp
#include <immintrin.h>

// 載入 16 個 float 到向量
__m512 a_vec = _mm512_load_ps(a);  // {1.0, 2.0, 3.0, ..., 16.0}
__m512 b_vec = _mm512_load_ps(b);  // {0.5, 0.5, 0.5, ..., 0.5}

// 一條指令完成 16 個加法！
__m512 c_vec = _mm512_add_ps(a_vec, b_vec);

// 存回記憶體
_mm512_store_ps(c, c_vec);

// 時間成本：1 條向量加法指令 = 1 個時鐘週期
// 加速：16x
```

**視覺化**：

```
Scalar (逐一計算):
a[0] + b[0] → c[0]   ━━  (1 cycle)
a[1] + b[1] → c[1]   ━━  (1 cycle)
a[2] + b[2] → c[2]   ━━  (1 cycle)
...
a[15] + b[15] → c[15] ━━  (1 cycle)
總共: 16 cycles

Vector (同時計算):
{a[0]..a[15]} + {b[0]..b[15]} → {c[0]..c[15]}  ━━  (1 cycle)
總共: 1 cycle
```

---

### 常用 AVX-512 Intrinsics 速查表

```cpp
#include <immintrin.h>  // AVX-512 標頭檔

// 型別定義
__m512   vec_float;   // 512-bit 向量 (16 個 float)
__m512i  vec_int;     // 512-bit 向量 (16 個 int32)
__mmask16 mask;       // 16-bit mask

// 1. 建立向量
__m512 vec = _mm512_set1_ps(3.14f);           // {3.14, 3.14, ..., 3.14}
__m512 vec = _mm512_setzero_ps();             // {0.0, 0.0, ..., 0.0}
__m512 vec = _mm512_load_ps(array);           // 從記憶體載入 (需對齊)

// 2. 算術運算
__m512 sum = _mm512_add_ps(a, b);             // a + b (16 組)
__m512 diff = _mm512_sub_ps(a, b);            // a - b (16 組)
__m512 prod = _mm512_mul_ps(a, b);            // a * b (16 組)

// 3. 比較運算（產生 mask）
__mmask16 mask = _mm512_cmple_ps_mask(a, b);  // a <= b ? 1 : 0
__mmask16 mask = _mm512_cmplt_ps_mask(a, b);  // a < b ? 1 : 0

// 4. Mask 條件運算
result = _mm512_mask_add_epi32(old, mask, a, b);
//       ^^^^^^^^^^^^^^^^^^^^^ 只有 mask=1 的 lane 才執行 a+b，否則保留 old

// 5. 儲存結果
_mm512_store_ps(array, vec);                  // 存回記憶體
```

**命名規則解析**：

```
_mm512_add_ps
 │││││  │   ││
 │││││  │   │└─ s: single (單精度, float)
 │││││  │   └── p: packed (向量)
 │││││  └────── add: 運算類型
 ││││└─────────── 512: 向量寬度 (512-bit)
 │││└──────────── mm: multimedia (SIMD 指令集)
 ││└───────────── _: 前綴
 │└────────────── intrinsic 函數

_mm512_mask_add_epi32
              ││ │││
              ││ ││└─ 32: 32-bit 整數
              ││ │└── i: integer
              ││ └─── p: packed
              │└───── e: extended (擴展型別)
              └────── mask: 帶 mask 的版本
```

---

## CPU Vector 實作：從分析到實踐

在開始寫向量化程式碼之前，我們需要先理解 **scalar 版本為什麼可以平行化**。這是向量化的基礎。

### Step 1: 分析 Scalar 版本的獨立性

讓我們重新檢視 scalar 版本的核心迭代邏輯：

```cpp
// 每個像素的計算
float x = 0.0f, y = 0.0f;
uint32_t iters = 0;

while (x*x + y*y <= 4.0f && iters < max_iters) {
    float x2 = x * x;        // ← 計算 1
    float y2 = y * y;        // ← 計算 2
    float w = 2.0f * x * y;  // ← 計算 3

    x = x2 - y2 + cx;        // ← 更新 x
    y = w + cy;              // ← 更新 y
    iters++;                 // ← 更新計數
}
```

**關鍵問題：這些運算之間有什麼依賴關係？**

#### 依賴分析（同一次迭代內）

```
迭代 N 的資料流：

輸入: x(N), y(N)
    ↓
┌───────────────────────────┐
│ x2 = x * x                │ ← 獨立計算 1
│ y2 = y * y                │ ← 獨立計算 2（與 x2 無關）
│ w = 2.0f * x * y          │ ← 獨立計算 3（與 x2, y2 無關）
└───────────────────────────┘
    ↓
┌───────────────────────────┐
│ x(N+1) = x2 - y2 + cx     │ ← 依賴 x2, y2
│ y(N+1) = w + cy           │ ← 依賴 w（與 x(N+1) 無關）
│ iters++                   │ ← 完全獨立
└───────────────────────────┘
    ↓
輸出: x(N+1), y(N+1), iters
```

**發現 1：同一次迭代內，`x2`, `y2`, `w` 的計算是完全獨立的！**

- `x2 = x * x` 不依賴 `y2`
- `y2 = y * y` 不依賴 `x2`
- `w = 2 * x * y` 不依賴 `x2` 或 `y2`

**發現 2：不同像素之間完全獨立！**

```
像素 0: x0, y0, iters0  ← 完全獨立
像素 1: x1, y1, iters1  ← 完全獨立
像素 2: x2, y2, iters2  ← 完全獨立
...
像素 15: x15, y15, iters15  ← 完全獨立
```

**這就是向量化的機會！**

### Step 2: 從 Scalar 到 Vector 的思維轉換

既然 16 個像素完全獨立，我們可以將它們「打包」成向量同時處理：

#### Scalar 思維（一次處理 1 個像素）

```cpp
// 像素 0
float x0 = 0.0f, y0 = 0.0f;
while (...) {
    float x2_0 = x0 * x0;
    float y2_0 = y0 * y0;
    x0 = x2_0 - y2_0 + cx0;
    y0 = 2*x0*y0 + cy0;
}

// 像素 1
float x1 = 0.0f, y1 = 0.0f;
while (...) {
    float x2_1 = x1 * x1;
    float y2_1 = y1 * y1;
    x1 = x2_1 - y2_1 + cx1;
    y1 = 2*x1*y1 + cy1;
}

// ... 重複 16 次 ...
```

#### Vector 思維（一次處理 16 個像素）

```cpp
// 將 16 個像素打包成向量
__m512 x_vec = {x0, x1, x2, ..., x15};     // 16 個 x 值
__m512 y_vec = {y0, y1, y2, ..., y15};     // 16 個 y 值

while (...) {
    // 一條指令同時計算 16 個 x²
    __m512 x2_vec = _mm512_mul_ps(x_vec, x_vec);

    // 一條指令同時計算 16 個 y²
    __m512 y2_vec = _mm512_mul_ps(y_vec, y_vec);

    // 一條指令同時更新 16 個 x
    x_vec = _mm512_add_ps(_mm512_sub_ps(x2_vec, y2_vec), cx_vec);

    // 一條指令同時更新 16 個 y
    y_vec = _mm512_add_ps(_mm512_mul_ps(_mm512_set1_ps(2.0f),
                          _mm512_mul_ps(x_vec, y_vec)), cy_vec);
}
```

**加速原理**：

```
Scalar: 16 次乘法指令 → 16 個時鐘週期
Vector: 1 次向量乘法 → 1 個時鐘週期（同時計算 16 個）

理論加速: 16x
```

### Step 3: 控制流發散的挑戰

但有一個問題：**不同像素的迭代次數可能不同！**

```cpp
// Scalar 版本
while (x*x + y*y <= 4.0f && iters < max_iters) {
    // 每個像素可以在不同時間點停止
}
```

```
像素 0:  迭代 10 次就逃逸  ━━━━━━━━━━
像素 5:  迭代 50 次才逃逸  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
像素 10: 迭代 30 次才逃逸  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
像素 15: 迭代 256 次(max)  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**問題**：在 SIMD 中，所有 16 個 lanes 必須執行相同的指令！

**解決方案**：使用 **Predication Mask** 追蹤哪些像素還在計算

接下來我們將依序處理：

1. **如何初始化這些向量**
2. **如何用 Predication Mask 處理控制流發散**
3. **如何將結果寫回記憶體**

---

### 實作細節 1：初始化向量

回顧我們在 Step 1 的分析，16 個像素需要不同的初始座標 `(cx, cy)`：

```cpp
// cx 向量：16 個像素有 16 個不同的 x 座標
alignas(64) float cx_array[16];
for (int k = 0; k < 16; k++) {
    // 計算第 j+k 個像素的 x 座標
    cx_array[k] = (float(j + k) / float(img_size)) * (cx_max - cx_min) + cx_min;
}
__m512 cx_vec = _mm512_load_ps(cx_array);
// 結果: cx_vec = {cx0, cx1, cx2, ..., cx15}

// cy 向量：同一列的 16 個像素共用相同的 y 座標
__m512 cy_vec = _mm512_set1_ps(cy);
// 結果: cy_vec = {cy, cy, cy, ..., cy} (16個相同值)

// 迭代變數初始化為 0（所有像素從原點開始）
__m512 x_vec = _mm512_setzero_ps();         // {0.0, 0.0, ..., 0.0}
__m512 y_vec = _mm512_setzero_ps();         // {0.0, 0.0, ..., 0.0}
__m512i iters_vec = _mm512_setzero_epi32(); // {0, 0, ..., 0}
```

**技術細節**：

- `alignas(64)`：確保 64-byte 對齊，AVX-512 載入更高效
- `_mm512_load_ps()`：從對齊的記憶體載入 16 個 float
- `_mm512_set1_ps()`：broadcast 單一值到 16 個 lanes（比迴圈快）
- `_mm512_setzero_ps()`：快速建立全零向量

**對應到 Step 2 的思維轉換**：

```
Scalar:  float x = 0.0f;
Vector:  __m512 x_vec = _mm512_setzero_ps();  // 16 個 0.0f
```

---

### 實作細節 2：Predication Mask 處理控制流發散

這是向量化 Mandelbrot 最關鍵的部分！回到 **Step 3** 的挑戰：

**問題重述**：16 個像素可能在不同時間點逃逸

```
像素 0:  迭代 10 次就逃逸  → 應該停止計算，iters[0] = 10
像素 5:  迭代 50 次才逃逸  → 繼續計算到第 50 次
像素 10: 迭代 30 次才逃逸  → 繼續計算到第 30 次
像素 15: 達到 max_iters   → 一直計算到最後
```

**衝突**：在 SIMD 中，所有 16 個 lanes 必須執行相同的指令！

```cpp
// Scalar 可以這樣寫
if (x*x + y*y > 4.0f) {
    break;  // 這個像素停止計算
}

// Vector 不能這樣寫！
if (某個 lane 的條件) {
    break;  // ❌ 無法讓單一 lane 停止
}
```

**解決方案：Predication Mask**

使用 **16-bit mask**（`__mmask16`）追蹤每個 lane 的狀態：

```
__mmask16 active_mask = 0b1111111111111111  (二進位)
                          ││││││││││││││││
                          ││││││││││││││└─ lane 0: 1 = active
                          │││││││││││││└── lane 1: 1 = active
                          ││││││││││││└─── lane 2: 1 = active
                          ...
                          └──────────────── lane 15: 1 = active
```

**核心思想**：

- `mask bit = 1`：這個 lane 還在計算（active）
- `mask bit = 0`：這個 lane 已逃逸（inactive）
- 每次迭代更新 mask，只對 active lanes 執行累加

```cpp
for (uint32_t iter = 0; iter < max_iters; iter++) {
    // Step 1: 檢查當前狀態：x² + y² <= 4.0
    __m512 magnitude = _mm512_add_ps(x2_vec, y2_vec);
    __mmask16 m_in = _mm512_cmp_ps_mask(magnitude, four, _CMP_LE_OQ);
    //                                                     ^^^^^^^^^^
    //                產生 mask: magnitude <= 4.0 的 lane 為 1

    // Step 2: 提早終止 - 所有 lane 都逃逸時退出
    if (!m_in) break;

    // Step 3: 計算下一次迭代的值
    __m512 x = _mm512_add_ps(_mm512_sub_ps(x2_vec, y2_vec), cx_vec);
    // 注意：浮點計算順序必須和 scalar 一致！
    __m512 y = _mm512_add_ps(_mm512_sub_ps(_mm512_sub_ps(w_vec, x2_vec), y2_vec), cy_vec);
    //         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //         (w - x2) - y2，而非 w - (x2 + y2)，浮點精度差異會累積！

    __m512 x2_new = _mm512_mul_ps(x, x);
    __m512 y2_new = _mm512_mul_ps(y, y);
    __m512 w_new = _mm512_mul_ps(_mm512_add_ps(x, y), _mm512_add_ps(x, y));

    // Step 4: 使用 mask 更新（關鍵：防止已逃逸 lane 繼續計算產生 NaN）
    x2_vec = _mm512_mask_mov_ps(x2_vec, m_in, x2_new);
    y2_vec = _mm512_mask_mov_ps(y2_vec, m_in, y2_new);
    w_vec = _mm512_mask_mov_ps(w_vec, m_in, w_new);

    // Step 5: 條件式累加 - 只有未逃逸的 lane 計數 +1
    iters_vec = _mm512_mask_add_epi32(iters_vec, m_in, iters_vec, one);
}
```

**Predication Mask 的關鍵步驟**：

1. **檢查條件**：每次迭代檢查當前的 magnitude（不累積 mask）
2. **提早終止**：所有 lane 逃逸時退出
3. **計算新值**：注意浮點運算順序必須和 scalar 一致
4. **Mask 更新**：只更新未逃逸的 lane（防止 NaN 傳播）
5. **條件計數**：只對未逃逸的 lane 增加計數

### Predication Mask 工作原理

讓我們用一個簡化的例子（4 個 lanes）來理解，概念可擴展到 16 個：

```
假設 4 個像素，在第 10 次迭代時：
  pixel_0: magnitude = 5.2 (>4.0) → 逃逸
  pixel_1: magnitude = 2.1 (<4.0) → 未逃逸
  pixel_2: magnitude = 1.8 (<4.0) → 未逃逸
  pixel_3: magnitude = 4.5 (>4.0) → 逃逸

步驟 1: 比較產生 cond_mask
  _mm512_cmple_ps_mask(magnitude, 4.0) →
  cond_mask = 0b0110  // 二進位表示
              ││││
              ││││
              │││└─ lane 0: 0 (false - 已逃逸)
              ││└── lane 1: 1 (true  - 未逃逸)
              │└─── lane 2: 1 (true  - 未逃逸)
              └──── lane 3: 0 (false - 已逃逸)

步驟 2: 更新 active_mask
  假設之前 active_mask = 0b1111 (全部 active)

  active_mask = _kand_mask16(active_mask, cond_mask)
              = 0b1111 & 0b0110
              = 0b0110
                ││││
                │││└─ lane 0: inactive (已逃逸)
                ││└── lane 1: active
                │└─── lane 2: active
                └──── lane 3: inactive (已逃逸)

步驟 3: 條件式累加
  _mm512_mask_add_epi32(iters_vec, active_mask, iters_vec, one)

  只有 active_mask 為 1 的 lanes 執行加法：
  → lane 0: iters[0] 不變（mask = 0）
  → lane 1: iters[1] += 1（mask = 1）
  → lane 2: iters[2] += 1（mask = 1）
  → lane 3: iters[3] 不變（mask = 0）
```

**AVX-512 的優勢**：

- 16-bit mask 非常輕量（只是一個整數）
- 提供專用的 mask 指令（`_kand_mask16`, `_kor_mask16` 等）
- 支援 masked 運算（`_mm512_mask_add_ps` 等），無需手動位元操作

這樣，即使 16 個像素在不同時間逃逸，我們仍能正確追蹤每個像素的迭代次數！

### 向量化的完整流程

總結 CPU 向量化的關鍵步驟：

```cpp
// 外層：每次處理 16 個相鄰像素
for (uint32_t j = 0; j < img_size; j += 16) {
    // 1. 初始化 16 個像素的向量
    __m512 cx_vec = ...; // 16 個不同的 cx
    __m512 cy_vec = ...; // 16 個相同的 cy
    __m512 x2_vec = _mm512_setzero_ps();
    __m512 y2_vec = _mm512_setzero_ps();
    __m512 w_vec = _mm512_setzero_ps();
    __m512i iters_vec = _mm512_setzero_epi32();

    // 2. 迭代計算
    for (uint32_t iter = 0; iter < max_iters; iter++) {
        // 檢查當前條件
        __m512 magnitude = _mm512_add_ps(x2_vec, y2_vec);
        __mmask16 m_in = _mm512_cmp_ps_mask(magnitude, four, _CMP_LE_OQ);

        if (!m_in) break;  // 提早終止

        // 計算下一次迭代（注意順序！）
        __m512 x = _mm512_add_ps(_mm512_sub_ps(x2_vec, y2_vec), cx_vec);
        __m512 y = _mm512_add_ps(_mm512_sub_ps(_mm512_sub_ps(w_vec, x2_vec), y2_vec), cy_vec);

        __m512 x2_new = _mm512_mul_ps(x, x);
        __m512 y2_new = _mm512_mul_ps(y, y);
        __m512 w_new = _mm512_mul_ps(_mm512_add_ps(x, y), _mm512_add_ps(x, y));

        // Mask 更新：防止逃逸 lane 繼續計算
        x2_vec = _mm512_mask_mov_ps(x2_vec, m_in, x2_new);
        y2_vec = _mm512_mask_mov_ps(y2_vec, m_in, y2_new);
        w_vec = _mm512_mask_mov_ps(w_vec, m_in, w_new);

        // 條件式計數
        iters_vec = _mm512_mask_add_epi32(iters_vec, m_in, iters_vec, one);
    }

    // 3. 寫回記憶體
    _mm512_storeu_epi32(result, iters_vec);
}
```

---

## CPU 效能測試與分析

現在讓我們看看向量化帶來的實際效能提升。

### 實測數據

使用 AVX-512 的理論加速分析（16-wide SIMD）：

#### 256×256, 256 iterations

```
CPU Scalar: 28.45 ms
CPU Vector: 2.83 ms  (約 10.05x 加速)
```

#### 512×512, 256 iterations

```
CPU Scalar: 116.35 ms
CPU Vector: 10.35 ms  (約 11.22x 加速)
```

#### 1024×1024, 256 iterations

```
CPU Scalar: 448.24 ms
CPU Vector: 39.91 ms  (約 11.22x 加速)
```

理論上，使用 16-wide SIMD 應該獲得 16x 加速，實際結果約為 **11-12x**

**未達到完美 16x 的原因**：

1. **控制流發散開銷**：不同 lanes 在不同時間逃逸，必須等最慢的 lane

   ```
   Lane  0: 10 次迭代   ━━━━━━━━━━
   Lane  5: 50 次迭代   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Lane 10: 30 次迭代   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   Lane 15: 25 次迭代   ━━━━━━━━━━━━━━━━━━━━━━━━━━━
                       ↑                                ↑
                       Lane 0 完成                      所有 lanes 都完成
                       但必須等其他 lanes
   ```

2. **Mask 操作開銷**：

   - `_mm512_cmple_ps_mask()` 產生 mask
   - `_kand_mask16()` 更新 active_mask
   - AVX-512 的 mask 操作已經很高效，開銷較小

3. **初始化和結果儲存**：

   - 建立 `cx_array` 並載入向量
   - 將 `iters_vec` 存回 `iters_array`
   - 迴圈邊界處理（最後不足 16 個像素）

4. **記憶體對齊檢查**：

   - `alignas(64)` 確保對齊
   - 未對齊會導致效能下降

---

## 技術總結與學習要點

透過 Mandelbrot 集合的向量化實作，我們學到了以下關鍵概念：

### 1. SIMD 的核心價值

**Single Instruction, Multiple Data** 讓我們用一條指令同時處理多個資料，是現代處理器提升效能的關鍵技術：

- **CPU SIMD**：128-bit (SSE) 到 512-bit (AVX-512)
- **理論加速比 = 向量寬度**：16-wide (AVX-512) → 16x

### 2. Predication Mask 的重要性

處理**控制流發散**是向量化最大的挑戰：

```
沒有 mask:        不同 lanes 無法有不同行為
使用 mask:        追蹤 active lanes，正確處理發散
```

**Predication mask 的關鍵步驟**：

1. 初始化 `active_mask = 0xFFFF`（全部 16 個 lanes active）
2. 每次迭代產生 `cond_mask`（條件檢查）
3. 更新 `active_mask = _kand_mask16(active_mask, cond_mask)`（保留仍 active 的）
4. 條件式累加（使用 `_mm512_mask_add_epi32` 只增加 active lanes 的計數）
5. 提早終止（所有 lanes 都 inactive 時跳出）

### 3. 何時使用向量化？

**適合向量化的情況**：

- 資料獨立（像素、向量元素等）
- 計算密集（減少記憶體存取的比例）
- 規則的記憶體訪問模式
- 有大量資料需要處理

**不適合向量化的情況**：

- 資料依賴（後一個計算依賴前一個結果）
- 記憶體密集（頻寬瓶頸）
- 高度不規則的控制流
- 資料量太小（向量化開銷大於收益）

### 4. 實用優化技巧

1. **選擇合適的向量寬度**：

   - 小型資料：128-bit (SSE, 4-wide)
   - 中型資料：256-bit (AVX2, 8-wide)
   - 大型資料：512-bit (AVX-512, 16-wide)

2. **記憶體對齊**：

   ```cpp
   alignas(64) float data[16]; // AVX-512 需要 64-byte 對齊
   alignas(32) float data[8];  // AVX2 需要 32-byte 對齊
   alignas(16) float data[4];  // SSE 需要 16-byte 對齊
   ```

3. **減少 mask 檢查頻率**：

   ```cpp
   // 不要每次迭代都檢查
   for (int iter = 0; iter < max_iters; iter++) {
       if (iter % 10 == 0) {  // 每 10 次檢查一次
           // 更新 mask...
       }
   }
   ```

4. **使用 compiler auto-vectorization**：

   ```bash
   # GCC/Clang
   g++ -O3 -march=native -ftree-vectorize

   # 檢查是否向量化
   g++ -O3 -march=native -fopt-info-vec
   ```

---

## 延伸閱讀與參考資料

### 課程資源

- **MIT 6.S894 Lab 1**: [https://accelerated-computing.academy/fall25/labs/lab1](https://accelerated-computing.academy/fall25/labs/lab1)

### AVX-512 與 x86 SIMD 學習資源

- **[Intel Intrinsics Guide](https://www.intel.com/content/www/us/en/docs/intrinsics-guide/index.html)**
- **[SIMD-Visualiser](https://github.com/piotte13/SIMD-Visualiser)**: 理解向量運算的視覺化工具

---

## 結語

從 scalar 到 vector 的優化之旅，不僅僅是追求效能提升的數字，更是理解現代 CPU 架構和向量化計算思維的過程。透過 Mandelbrot 集合這個經典範例，我們學到了：

1. **SIMD 是 CPU 高效能計算的關鍵**：現代處理器透過向量指令達到單線程內的並行加速
2. **Predication mask 是控制流處理的核心**：顯式管理 masks 讓我們能在向量化中處理複雜的控制流
3. **顯式向量化需要精細控制**：使用 intrinsics 雖然複雜，但能充分發揮硬體潛力
4. **理論與實踐的結合**：12-16× 加速來自對硬體特性的深入理解和精心優化

<!-- ### 下一步：從 CPU SIMD 到 GPU 並行 -->

<!-- 如果你對大規模並行計算感興趣，可以繼續閱讀： -->
<!-- - **[Mandelbrot GPU 並行化](mandelbrot-gpu-parallel.md)**：從 CPU 向量化到 GPU 大規模線程並行的思維轉換 -->

希望這篇文章能幫助你理解 CPU 向量化的核心概念，並在自己的專案中應用這些技術。記住，效能優化是一個持續學習和實驗的過程，保持好奇心和動手實踐的精神！
