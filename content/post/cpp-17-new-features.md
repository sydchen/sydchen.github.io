+++
date = '2025-10-23T23:15:20+08:00'
draft = false
title = 'C++17：新特性總覽與實用指南'
tags = ['C++', 'C++17']
+++

2017 年，C++17 正式登場。
這次不像 C++11 那樣革命性，但比 C++14 更有感。
不只是語法糖 (syntax sugar)，還有編譯期功能強化與更聰明的標準函式庫。
以下我們就輕鬆地走一遍重點特色。

<!--more-->

## Language Features：語法變得更人性化

### Class Template Argument Deduction (CTAD)

```cpp
// C++17 前
std::pair<int, double> p{42, 3.14};
std::vector<int> v{1, 2, 3};

// C++17 後
std::pair p{42, 3.14};  // 自動推導為 std::pair<int, double>
std::vector v{1, 2, 3}; // 自動推導為 std::vector<int>
```

詳細可以參考[C++17 類別樣板引數推導 (CTAD)](/post/cpp-class-template-argument-deduction/)

### if / switch 初始化語法

有時候我們只是想在 `if` 或 `switch` 裡用個暫時變數，結果卻得多寫好幾行。
C++17 終於讓這件事變簡單了：

```cpp
if (auto it = map.find(key); it != map.end()) {
    std::cout << it->second;
}  // it 只在 if 內有效
```

`switch` 也可以這樣用：

```cpp
switch (int x = getValue(); x) {
    case 0: break;
    default: std::cout << x;
}
```

看起來就整潔多了，作用域也更安全。

---
### Structured Bindings (結構化綁定)

以前我們從 `std::pair` 或 `std::tuple` 取值，要一直 `.first`、`.second`，
現在直接「拆開」變數就行：

```cpp
std::tuple t{42, "Hello"};
auto [num, text] = t;
std::cout << num << " " << text;
```

搭配 map 迭代更香：

```cpp
for (auto& [key, value] : my_map) {
    std::cout << key << " => " << value << '\n';
}
```

---
### Inline Variables

以前想在 header 裡定義全域變數，要小心多重定義問題。
C++17 給出救星：`inline`。

```cpp
// config.hpp
struct Config {
    static inline const int version = 2;
};
```

這樣就能在多個檔案中 include，而不用擔心 linker 抱怨。

---
### constexpr 更強大

詳細可以參考[從 C++11 到 C++23：constexpr 的演進之路](/post/cpp-constexpr/)

---
### Fold Expressions (折疊表達式)

傳統遞迴方式求和範例：

```cpp
template<typename T>
T old_sum(T value) {
    return value;
}

template<typename T, typename... Args>
T old_sum(T first, Args... args) {
    return first + old_sum(args...);
}

std::cout << "傳統遞迴求和: " << old_sum(1, 2, 3, 4, 5) << std::endl; // 傳統遞迴求和: 15
```

現在有了 *Fold Expressions*
可以這樣寫

```cpp
template<typename... Args>
auto sum_right(Args... args) {
    return (args + ...);  // 展開為：arg1 + (arg2 + (arg3 + arg4))
}

std::cout << "右摺疊求和: " << sum_right(1, 2, 3, 4, 5) << std::endl; // 右摺疊求和: 15
```

終於不用手動展開參數包了。關於 *Fold Expressions* 的更多細節，我會另外再寫一篇文章深入介紹。

---
### [[nodiscard]]

有些函式的回傳值你最好別忽略，
C++17 提供了 `[[nodiscard]]` 來提醒你這件事：

```cpp
[[nodiscard]] int compute();

compute();  // 編譯器會警告你結果被丟掉
```

有點像老師在旁邊說：「欸這題答案你沒寫喔。」

---
### namespace 簡化

以前我們得一直重複 namespace：

```cpp
namespace mylib {
    namespace util {
        void foo();
    }
}
```

現在直接：

```cpp
namespace mylib::util {
    void foo();
}
```

清爽多了。

---
## Standard Library：工具箱更聰明了

### `std::optional<T>`

表示「可能有值也可能沒有值」，取代傳統的 `nullptr` 或特殊值（如範例中的 -1）判斷：

以前的寫法：

```cpp
int findUserId(std::string name) {
    if (name == "Syd") return 42;
    return -1;  // 用 -1 表示找不到
}

```

現在可以這樣寫，讓 return value 更語意化，也更安全。

```cpp
#include <optional>
#include <string>

std::optional<int> findUserId(std::string name) {
    if (name == "Syd") return 42;
    return std::nullopt;  // 清楚地表示「沒有值」
}

int main() {
    if (auto id = findUserId("Bob")) {
        std::cout << "User ID: " << *id << "\n";
    } else {
        std::cout << "User not found\n";
    }
}
```

---
### std::variant

可以把它想成一個型別安全的 *union*，但與傳統 *union* 不同的是，
`std::variant` 會記住目前是哪一種型別，並在你取值時自動檢查安全性。

```cpp
std::variant<int, std::string> v = 42;   // 現在 v 裡面是 int
std::cout << std::get<int>(v) << "\n";   // 42

v = std::string("Hello");
std::cout << std::get<std::string>(v) << "\n";  // Hello
```

比起 `void*`，這個強大又不容易出錯。

---
### std::any

`std::any` 是一個型別安全的動態容器。
但為了保證型別安全，它在編譯時不允許你「直接取值」，
你必須用 `std::any_cast<T>` 明確告訴它要取出哪種型別。

```cpp
std::any a = 42;

int value = std::any_cast<int>(a);  // OK
std::string s = std::any_cast<std::string>(a);  // 錯誤！會拋出 std::bad_any_cast 例外
```

```cpp
std::any a = 42;
a = std::string("Hello");

if (a.type() == typeid(std::string)) {
    std::cout << std::any_cast<std::string>(a);
}
```

超方便，但要小心型別轉換失敗會丟例外。

---
### std::string_view – 不複製字串的輕量引用

`std::string_view` 是一個「輕量級的只讀字串視圖（view）」
，它不擁有字串內容本身，只是**指標** + **長度**的包裝。
用來避免不必要的字串複製，提高效能：

基本用法:

```cpp
#include <string_view>
#include <iostream>

void print(std::string_view sv) {
    std::cout << "字串內容: " << sv << "\n";
    std::cout << "長度: " << sv.size() << "\n";
}

int main() {
    std::string s = "Hello World";
    print(s);               // 可以直接傳 string
    print("Hello World");   // 或是傳字面值

    // 大部分操作和 std::string 一樣
    std::string_view sv = "Hello world";
    std::cout << sv.size();     // 11
    std::cout << sv.substr(0, 5); // "Hello"
    std::cout << sv[1];         // 'e'
    // std::cout << sv.starts_with("Hel"); // C++20 起可用
    std::cout << (sv.substr(0, 3) == "Hel") << std::endl; // C++17 的做法
}
```

#### 生命週期陷阱

`std::string_view` 不擁有資料本身，因此你必須保證它所參考的字串活著。

```cpp
std::string_view bad_view;
{
    std::string s = "Hello";
    bad_view = s;
} // s 被銷毀，bad_view 變成懸空指標
std::cout << bad_view << "\n"; // 未定義行為
```

#### 在 LLM / tokenizer 中很重要

因為 tokenizer 和推論前處理中會進行**大量的字串切片、比較、搜尋、分段**，如果用 `std::string`：

* 每次都會產生新物件 (O(n))
* 大量複製導致記憶體壓力與 GC 壓力(尤其對長 prompt)

用 `std::string_view`：

* 切片不會複製 (O(1))
* 可快速比較 / slice / split
* 可直接指向原始輸入記憶體(不佔空間)

範例Tokenizer：

```cpp
void tokenize(std::string_view text) {
    size_t pos = 0;
    while (true) {
        auto next = text.find(' ', pos);
        if (next == std::string_view::npos) break;

        std::string_view token = text.substr(pos, next - pos);
        std::cout << "[" << token << "]";
        pos = next + 1;
    }
}
```

---
### std::filesystem

標準庫原生支援跨平台檔案操作！

在C++17以前：

```cpp
#include <iostream>
#include <dirent.h>   // for DIR, opendir, readdir
#include <sys/types.h>

int main() {
    const char* path = ".";
    DIR* dir = opendir(path);
    if (!dir) {
        perror("opendir");
        return 1;
    }

    // 逐一掃描該目錄下的所有項目(檔案、資料夾）。
    struct dirent* entry;
    while ((entry = readdir(dir)) != nullptr) {
        std::cout << entry->d_name << '\n';
    }

    closedir(dir);
    return 0;
}
```

缺點是：API 是 C 語言風格，不直覺。`struct dirent` 在不同系統上欄位定義不同。
Windows 完全不支援(因為`dirent.h`是POSIX系統的函式庫)

C++17後可以這樣寫：

```cpp
#include <filesystem>
namespace fs = std::filesystem;

// 逐一掃描該目錄下的所有項目(檔案、資料夾）。
for (auto& p : fs::directory_iterator("/tmp")) {
    std::cout << p.path() << '\n';
}

try {
    if (fs::exists("/tmp/test.txt")) {
        std::cout << "檔案存在\n";
        auto size = fs::file_size("/tmp/test.txt");
        std::cout << "檔案大小: " << size << " bytes\n";
    } else {
        std::cout << "檔案不存在\n";
    }
} catch (const fs::filesystem_error& e) {
    std::cerr << "錯誤: " << e.what() << '\n';
}

// 建立目錄
fs::create_directories("/tmp/new/path");
```

---
## 其他小更新

### std::clamp()

`std::clamp()`限制數值範圍

```cpp
int value = 120;
int clamped = std::clamp(value, 0, 100);

std::cout << "原值: " << value << '\n';
std::cout << "限制後: " << clamped << '\n';

// 等價於
if (value < min) value = min;
else if (value > max) value = max;
```

### std::as_const()
將物件轉為 const 引用。

---
## 總結
C++17 就像一次春季大掃除，沒改變房子的結構，卻讓每個角落都順手多了。
程式碼更簡潔、錯誤更少、速度也不打折。

本文章的範例程式碼放在[github](https://github.com/sydchen/cpp_examples/blob/main/cpp17.cpp)

