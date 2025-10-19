+++
date = '2025-10-18T17:52:45+08:00'
draft = false
title = '從 C++11 到 C++23：constexpr 的演進之路'
tags = ['C++', 'constexpr', 'Compile-Time Programming']
+++

C++11 首次引入 *constexpr*，要求這個值或函式「可以在編譯期計算」(*constexpr* 可以在編譯期或執行期計算，取決於上下文)，
簡單說就是，「讓編譯器幫你算出結果，而不是在執行時浪費時間」。
但那時它的限制非常多，幾乎只能做簡單的數學計算。

<!--more-->
## C++11：constexpr 的誕生

直接看範例

```cpp
constexpr int square(int x) {
    return x * x;
}

constexpr int val = square(5);
std::cout << val << std::endl; // 25
int arr[square(3)];
```

限制很多比如說以下就會編譯錯誤

```cpp
// Error: 有多個return
constexpr int square(int x) {
    if (x > 5)
        return x * x;
    else
        return x * x * x;
}

// Error: constexpr function never produces a constant expression
constexpr int square(int x) {
    x += 1;
    return x * x;
}
```

C++11 的 constexpr 函式限制很嚴格，幾乎只能寫單一表達式

---
## C++14：讓 constexpr 真正「能寫程式」

C++14 是 *constexpr* 的大躍進。
從這一版開始，*constexpr* 函式可以包含幾乎所有常見的控制流程語句。

例如：

* 支援 `if`, `for`, `while`, `do-while`
* 支援多行邏輯
* 支援局部變數

上面C++11編譯會出錯的程式沒問題了

```cpp
constexpr int square(int x) {
    if (x > 5)
        return x * x;
    else
        return x * x * x;
}

constexpr int val = square(4);
std::cout << val << std::endl; // 64
```

```cpp
constexpr int square(int x) {
    x += 1;
    return x * x;
}

constexpr int val = square(5);
std::cout << val << std::endl; // 36
```

Fibonacci sequence

```cpp
constexpr int fib(int n) {
    int a = 0, b = 1;
    for (int i = 0; i < n; ++i) {
        int temp = a + b;
        a = b;
        b = temp;
    }
    return a;
}

constexpr int result = fib(10); // 55
```

這讓 *constexpr* 函式真正能像一般函式一樣寫，而不只是數學表達式。

---
## C++17：constexpr 與標準庫的擴展

C++17 引入了 `if constexpr`，這是編譯期條件判斷的重要工具，並且讓標準函式庫的更多內容支援 constexpr。

### 範例1：模板與 constexpr if 結合

```cpp
template<int N>
constexpr auto make_powers_array() {
    std::array<int, N> arr{};
    for (int i = 0; i < N; ++i) {
        if constexpr (N <= 10) {
            arr[i] = i * i;  // 平方
        } else {
            arr[i] = i * i * i;  // 立方
        }
    }
    return arr;
}

constexpr auto small_powers = make_powers_array<5>();
constexpr auto large_powers = make_powers_array<15>();

std::cout << "小陣列 (N=5, 平方): ";
for (const auto& val : small_powers) {
    std::cout << val << " ";
}
std::cout << std::endl;

std::cout << "大陣列 (N=15, 立方): ";
for (size_t i = 0; i < 5; ++i) {  // 只顯示前5個
    std::cout << large_powers[i] << " ";
}
std::cout << "..." << std::endl;
```

輸出：
```
小陣列 (N=5, 平方): 0 1 4 9 16
大陣列 (N=15, 立方): 0 1 8 27 64 ...
```

---
### 範例2：constexpr lambda - 編譯時 lambda 表達式

```cpp
constexpr auto add_lambda = [](int a, int b) constexpr {
    return a + b;
};

constexpr int sum = add_lambda(10, 20);
std::cout << "constexpr lambda 計算: 10 + 20 = " << sum << std::endl; // constexpr lambda 計算: 10 + 20 = 30
```

---
### 範例3：constexpr 建構子和成員函數

```cpp
struct Point {
    int x, y;

    constexpr Point(int x, int y) : x(x), y(y) {}

    constexpr int distance_squared() const {
        return x * x + y * y;
    }

    constexpr Point operator+(const Point& other) const {
        return Point(x + other.x, y + other.y);
    }
};

constexpr Point p1(3, 4);
constexpr Point p2(1, 2);
constexpr Point p3 = p1 + p2;
constexpr int dist = p1.distance_squared();

std::cout << "Point p1(3,4) 距離平方: " << dist << std::endl;
std::cout << "p1 + p2 = (" << p3.x << ", " << p3.y << ")" << std::endl;
```

輸出:
```
Point p1(3,4) 距離平方: 25
p1 + p2 = (4, 6)
```

---
### 範例4：constexpr 陣列和容器操作

```cpp
constexpr std::array<int, 5> create_sequence() {
    std::array<int, 5> arr{};
    for (size_t i = 0; i < arr.size(); ++i) {
        arr[i] = static_cast<int>(i * i);
    }
    return arr;
}

constexpr auto sequence = create_sequence();
std::cout << "平方數列: ";
for (const auto& val : sequence) {
    std::cout << val << " ";
}
std::cout << std::endl;
```

輸出
```
平方數列: 0 1 4 9 16
```

---
### 範例5：編譯期產生 CRC32 查表

```cpp
constexpr uint32_t crc32_polynomial = 0xEDB88320u;

constexpr std::array<uint32_t, 256> generate_crc_table() {
    std::array<uint32_t, 256> table = {};
    for (uint32_t i = 0; i < 256; ++i) {
        uint32_t c = i;
        for (int j = 0; j < 8; ++j)
            c = (c >> 1) ^ (crc32_polynomial & (-(int32_t)(c & 1)));
        table[i] = c;
    }
    return table;
}

constexpr auto crc_table = generate_crc_table();

constexpr uint32_t crc32(const char* str) {
    uint32_t crc = 0xFFFFFFFFu;
    for (; *str; ++str)
        crc = (crc >> 8) ^ crc_table[(crc ^ *str) & 0xFF];
    return crc ^ 0xFFFFFFFFu;
}

int main() {
    constexpr auto val = crc32("constexpr");
    std::cout << std::hex << val << std::endl; // 176f423f
}
```

如果是C++14編譯會有錯誤:
```
non-constexpr function 'operator[]' cannot be used in a constant expression
```

---
## C++20：constexpr 幾乎無所不能(含虛擬函式與動態記憶體)

C++20 把 *constexpr* 提升到新的層次，讓 *constexpr* 幾乎能模擬「小型執行期世界」，連配置與釋放記憶體都能在編譯期完成。

### 允許虛擬函式在 constexpr 情境中使用

```cpp
struct Sorter {
    virtual constexpr void sort_impl() const = 0;
    virtual constexpr ~Sorter() = default;
};

struct QuickSorter : Sorter {
    constexpr void sort_impl() const override {
        // QuickSort
    }
};

struct MergeSorter : Sorter {
    constexpr void sort_impl() const override {
        // MergeSort
    }
};

// 編譯期選擇排序策略
constexpr auto choose_sorter() {
    #if DATA_SIZE > 1000000
    return MergeSorter{};
    #else
    return QuickSorter{};
    #endif
}
```

### 有條件的允許使用動態記憶體配置

```cpp
constexpr int allocate_example() {
    int* ptr = new int(100);
    int result = *ptr * 2;
    delete ptr;  // 記憶體必須在同一個 constexpr 表達式內釋放
    return result;
}

constexpr int value = allocate_example();
```
### 支援更多STL容器
C++20 允許使用 *std::vector*、*std::string*、*std::array*，但記憶體必須在同一個 constexpr 表達式內完整配置與釋放。
不過 *std::map*、*std::set*、*std::unordered_map* 這些樹狀結構容器還沒辦法使用(這些容器在編譯期的記憶體配置和節點管理存在技術困難)

#### 範例: 編譯期求和

```cpp
#include <vector>
#include <string>
#include <numeric>

constexpr int process_vector() {
    std::vector<int> nums = {1, 2, 3, 4, 5};
    return std::accumulate(nums.begin(), nums.end(), 0);
}

constexpr int total = process_vector();
```

#### 範例: 編譯期排序

```cpp
#include <algorithm>
#include <array>

constexpr std::array<int, 5> compile_time_sort() {
    std::array<int, 5> arr = {5, 2, 8, 1, 9};
    std::sort(arr.begin(), arr.end());
    return arr;
}

constexpr auto sorted_arr = compile_time_sort();
static_assert(sorted_arr[0] == 1);
```

---
## C++23：更多容器與 std::unique_ptr 支援

### std::bitset、std::optional、std::variant

```cpp
#include <bitset>
#include <optional>
#include <variant>

constexpr std::bitset<8> bits(0b11010110);
constexpr auto result = bits.count();

constexpr std::optional<int> opt = 42;
constexpr auto value = opt.value();

constexpr std::variant<int, double> var = 3.14;
constexpr auto dval = std::get<double>(var);
```

### std::unique_ptr

```cpp
#include <iostream>

constexpr auto test_unique_ptr() {
    auto ptr = std::make_unique<int>(42);
    int result = *ptr;
    return result;
}

int main()
{
    constexpr int value = test_unique_ptr();
    std::cout << value << std::endl;
}
```
---
## 何時該用 constexpr?
- 當計算結果在編譯期就能確定(如查表、配置參數、型別計算)
- 當你需要在模板元編程中進行複雜邏輯(取代傳統的 template metaprogramming)
- 當你想減少執行期開銷，把工作提前到編譯期完成

但記住：不是所有東西都該 *constexpr*。
過度使用會：
- 拖慢編譯速度(編譯期計算也需要時間)
- 增加編譯期記憶體消耗
- 讓錯誤訊息變得更難理解
- 讓除錯變得困難(無法在編譯期設中斷點)

## 結語

*constexpr* 的演進史，本質上是「**編譯期計算能力邊界的不斷擴張**」。

C++ 的設計哲學是「能在編譯期做的，就不要留到執行期」。
從 C++11 到 C++23，constexpr 逐步打破了以下限制：

| 版本 | 突破的限制 |
|------|------------|
| C++11 | 只能寫單一 return 表達式 |
| C++14 | 允許控制流與區域變數 |
| C++17 | 標準庫支援 + `if constexpr` |
| C++20 | 虛擬函式 + 動態記憶體配置 |
| C++23 | 更多 STL 容器與 `std::unique_ptr` |

從「優化手段」到「程式設計範式」，*constexpr* 已經成為現代 C++ 不可或缺的一部分。
它模糊了「編譯期元編程(Template Metaprogramming)」與「一般程式碼」的界線，
讓 C++ 成為少數能在編譯期執行複雜邏輯的語言。

下一步呢？也許是 *constexpr* 支援更多 I/O 操作，或是與 Reflection 結合，實現更強大的編譯期程式生成能力。
