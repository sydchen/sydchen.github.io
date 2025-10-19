+++
date = '2025-10-15T19:08:52+08:00'
draft = false
title = 'C++：深入理解 Template Argument Deduction'
tags = ['C++', 'Template', 'Type Deduction']
+++

C++ 的模板（Template）一直是讓人又愛又恨的存在。
它讓程式碼可以泛用、可重複使用，但也經常讓編譯錯誤變成一首 200 行的詩。

其中最神秘的一環，就是「模板參數推導」(**Template Argument Deduction**, 簡稱 **TAD**)。
這是編譯器在呼叫模板函式時，嘗試猜出該使用哪一種型別版本的過程。
理解它，就像是理解 C++ 泛型魔法的核心語法糖。

<!--more-->

## 模板推導是怎麼發生的?

當你寫下這行簡單的程式：

```cpp
template<typename T>
T add(T a, T b) {
    return a + b;
}

int main() {
    auto result = add(3, 5);
}
```

你並沒有明確告訴編譯器 `T` 是什麼。
但編譯器會幫你「推導」（deduce）出 `T = int`。

這個「推導」的過程就是 **TAD**。
C++ 編譯器根據實際傳入的引數（arguments），從函式參數型別中反推出模板參數型別。
所以你不需要寫成 `add<int>(3, 5)`。

---
## 推導規則不是魔法，而是一套嚴格的規則

C++ 的模板推導看似聰明，其實非常「保守」——
編譯器只允許幾種特定的自動轉換（conversion）：

1. **const 轉換**：
   非 const → const 是允許的。

```cpp
template<typename T>
void print(const T& val);

int i = 42;
print(i);  // OK, int -> const int
```

2. **陣列／函式指標轉換**：
陣列會自動轉成指標。

```cpp
template<typename T>
void foo(T , T ) {
    std::cout << "foo called\n";
}

template<typename T>
void bar(const T&) {
    std::cout << "bar called\n";
}

template<typename T>
void bar2(const T&, const T&) {
    std::cout << "bar2 called\n";
}

int main()
{
    int a[10], b[12];
    foo(a, b);  // T 被推導為 int*
    bar(a);  // T 被推導為 int[10]
    // bar2(a, b); // error: array types don’t match 'int[10]' vs. 'int[12]'
}
```

但其他型別的轉換，例如：
- `int` → `double` (arithmetic conversions)
- 子類轉父類(derived-to-base)
- 自定義轉換(user-defined conversions)

都會讓推導失敗。這也是為什麼下面這行會報錯：

```cpp
template <typename T>
int compare(const T &v1, const T &v2)
{
    if (v1 < v2) return -1;
    if (v2 < v1) return 1;
    return 0;
}

long lng = 10;
compare(lng, 3); // error: 無法推導 T，因為兩個參數型別不一致
```

如果你想讓它能比較不同型別，就得自己定義多個模板參數：

```cpp
template<typename A, typename B>
int flexibleCompare(const A& a, const B& b);

flexibleCompare(lng, 1024) // ok
```

---
### Explicit Template Arguments：明確指定模板參數：當推導不夠聰明時

有時候，編譯器根本推不出來該用哪一種型別。
例如我們想寫個加法模板，但希望能控制「回傳型別」的精度：

```cpp
template<typename R, typename T1, typename T2>
R sum(T1 a, T2 b) {
    return a + b;
}
```

這裡 `R` 並沒有出現在參數中，所以編譯器沒辦法推導。
必須由使用者明確指定：

```cpp
auto val = sum<long long>(3, 4.5); // R = long long
```

只能省略尾部的模板參數，且這些參數必須能從函式引數中推導出來。
下面程式T3推導不出來，會錯誤!

```cpp
template <typename T1, typename T2, typename T3>
T3 alternative_sum(T2, T1);

auto val3 = alternative_sum<long long>(i, lng);  // error
```

---
### Trailing Return Type：當型別依賴參數時

有時候我們想寫一個模板函式，它的回傳型別取決於參數。
像這樣：

```cpp
template<typename It>
??? fcn(It beg, It end) {
    return *beg; // 回傳迭代器指向的元素
}
```

呼叫範例如下

```cpp
vector<int> vi = {1, 2, 3, 4, 5};
Blob<string> ca = {"hi", "bye"};

auto &i = fcn(vi.begin(), vi.end()); // 希望回傳 int&
auto &s = fcn(ca.begin(), ca.end()); // 希望回傳 string&
```

但這裡的 `???` 該怎麼寫？寫成 `It&` 嗎?

```cpp
vector<int>::iterator it = vi.begin();

It = vector<int>::iterator
*it 的型別是 int&

It&  => vector<int>::iterator&
*beg => int& // 顯然It& 和 *beg 不是同一種型別。
```

解法是使用 **trailing return type (尾隨回傳型別)**：

```cpp
template<typename It>
auto fcn(It beg, It end) -> decltype(*beg) {
    return *beg;
}
```

這樣 `decltype(*beg)` 會在編譯期被替換成實際的型別，例如 `int&` 或 `string&`。

小技巧：
- `decltype(*beg)` 會得到「參考型別」，如果你想回傳值（非參考），可以用
- C++11: `remove_reference<decltype(*beg)>::type` 來移除參考。
- C++14: `remove_reference_t<decltype(*beg)>` 更簡潔

---
## type_traits：模板世界的型別工廠

C++11 引入的 `<type_traits>` 提供了一整套型別轉換模板。
這些模板就像「型別的變形金剛」，能在編譯期做靜態型別變換。

常見例子：

| 模板                    | 功能            |
| --------------------- | ------------- |
| `remove_reference<T>` | 移除 `&` 或 `&&` |
| `add_const<T>`        | 增加 `const`    |
| `add_pointer<T>`      | 增加指標屬性        |
| `make_unsigned<T>`    | 轉成無號型別        |

例如：

```cpp
typename remove_reference<decltype(*beg)>::type x;
```

這樣可以保證 `x` 是「元素型別本身」，而不是參考。

---

## 函式指標與模板推導

當你把函式模板指派給函式指標時，
編譯器會根據指標型別推導模板參數：

```cpp
template<typename T>
int compare(const T&, const T&);

int (*pf)(const int&, const int&) = compare; // T = int
```

但如果有多個可能型別就會報錯：

```cpp
void func(int(*)(const string&, const string&));
void func(int(*)(const int&, const int&));

func(compare); // ❌ 模糊不清，無法決定版本
```

解法是明確指定：

```cpp
func(compare<int>);
```

---
## 當模板參數牽涉到參考(reference)

當模板參數牽涉到參考(reference)，編譯器在進行**模板型別推導(Template Argument Deduction)** 時是怎麼判斷的?

這是 C++ 模板最玄的部分。首先是Lvalue Reference

### Lvalue Reference

1. 參數是 T&：只能綁定 lvalue

```cpp
template <typename T>
void f1(T&);  // 只能接受左值 (lvalue)

int i = 42;
const int ci = i;

f1(i);   // T = int
f1(ci);  // T = const int
f1(5);   // 編譯錯誤：5 是 rvalue，不能綁定到 T&
```

2. 參數是 const T&：幾乎什麼都能傳(蛤?)

這時候情況就不一樣了。
`const T&` 可以綁定任何東西──包括 const 物件、暫時物件、甚至字面值(literal)。
而在推導 `T` 時，編譯器會「忽略掉」原本引數的 const 屬性。
因為參數本身已經是 const，所以不需要再讓 T 帶上 const。

```cpp
template <typename T>
void f2(const T&);  // 可以接受任何類型的引數

int i = 42;
const int ci = i;

f2(i);   // T = int
f2(ci);  // T = int
f2(5);   // T = int, 雖然5是R value，但是const T&還是可以綁定
```

為什麼這樣設計? 這是為了讓「函式模板」在常見情況下更直覺

```cpp
template <typename T>
void print(const T& value) {
    std::cout << value << std::endl;
}
```

你希望 print 能印：
- 普通變數(`int i`)
- const 變數(`const int ci`)
- 字面常數(`42`)
- 暫時物件(`std::string("Hi")`)

C++ 的規則正是為了讓這些通通能編譯成功。

---
### Rvalue Reference
前面我們看過：

* `T&` 只能接受左值（lvalue）
* `const T&` 幾乎什麼都能接受

現在要來看 C++ 模板裡最有「黑魔法」氣息的一種：`T&&` —— 它可以根據引數的型別自動變形，
同時接受左值與右值。這種參考在 C++11 之後有個專門名稱：**Forwarding reference**（或早期叫 Universal Reference）。

```cpp
template <typename T>
void f3(T&& param);

int i = 42;
const int ci = i;

f3(42);  // 傳入 rvalue, T = int
f3(i);   // 傳入 lvalue, T = int&
f3(ci);  // 傳入 const lvalue, T = const int&
```

這裡的 T&& 不是單純的右值參考(rvalue reference)。它是一種「模板型別參考」，具有自我變形能力：
那這個 `T&&` 究竟是「右值參考」還是「萬用參考(forwarding reference)」？

答案是：**看呼叫時傳入什麼**。

* 傳入右值 → `T` 被推導為原始型別，例如 `int`，所以參數是 `int&&`
* 傳入左值 → `T` 被推導為 `int&`，參數型別變成 `int& &&`，依照規則坍縮成 `int&`

這就是 **reference collapsing** 規則，C++ 為了處理這種模板情境所定義的特殊規則：

| 原始型別     | 經坍縮後(collapses to)  |
| -------- | ----- |
| `X& &`   | `X&`  |
| `X& &&`  | `X&`  |
| `X&& &`  | `X&`  |
| `X&& &&` | `X&&` |

只有兩個右值引用結合才會產生右值引用

結論：
`T&&` 是個「雙面人」——它在模板裡既能接受右值，也能接左值。
這是 `std::move` 和 `std::forward` 得以存在的基礎。

---
### std::move：把左值變成右值的魔法

*std::move* 的實作如下(簡化版)：

```cpp
template<typename T>
typename remove_reference<T>::type&& move(T&& t) {
    return static_cast<typename remove_reference<T>::type&&>(t); // 將 T 的參考去除後再加上 &&，把 t 強制轉為右值引用
}
```
當 `T` 被推導為 `int&` 時，根據參考折疊規則，`T&&` 會折疊為 `int&`，為了確保 `move` 的回傳型別永遠是右值引用(`int&&`)，
使用 `remove_reference<T>::type&&` 來去除 `T` 的參考再加上右值引用。

- 它接受任何型別(左值或右值)。
- 透過 `static_cast` 把參數轉成右值引用。
- 不會真的「搬動」資料，只是告訴編譯器「這個物件可以被偷走」。

範例：

```cpp
string s1 = "hello";
string s2 = std::move(s1);  // s1 被轉為右值，可安全轉移內容
```

這樣 `s2` 取得 `s1` 的資源，而 `s1` 則進入「可使用但未定義值」的狀態。

---

### std::forward：完美轉發的關鍵
我們想寫一個「通用轉發（universal wrapper）」函式
想像我們要寫一個通用函式 `relay`，
它的工作就是——

> 接收任何引數，然後把它轉交給另一個函式。

這聽起來很簡單，對吧？
我們先寫最直覺的版本。

---
### 最天真的版本

```cpp
#include <iostream>
#include <utility>
using namespace std;

void process(int& x) {
    cout << "process(int&): lvalue version\n";
}

void process(int&& x) {
    cout << "process(int&&): rvalue version\n";
}

template <typename T>
void relay(T arg) {
    process(arg);
}

int main() {
    int i = 42;
    relay(i);     // 傳左值
    relay(99);    // 傳右值
}
```

---
輸出結果

```
process(int&): lvalue version
process(int&): lvalue version   ❌ 錯誤：右值變成左值
```

第二行發生什麼事？
`relay(99)` 傳入右值，卻呼叫了 `process(int&)`（左值版本）。

為什麼呢？因為在 `relay` 內部，`arg` 已經是一個具名變數：

```cpp
void relay(T arg) { process(arg); }
```

不論它最初是左值還是右值，只要有名字，它就是**左值**。

所以 `process(arg)` 永遠會呼叫左值版本。
這就是右值「被吃掉」的原因。

---
解法一：用 `std::move`

我們可以強制把它變回右值：

```cpp
template <typename T>
void relay_move(T arg) {
    process(std::move(arg));
}
```

結果：

```
process(int&): lvalue version
process(int&&): rvalue version
```

這次右值正確了。但問題是——
`relay_move(i)`（傳左值）時，也會被 `move` 成右值! 這會導致「左值被不該轉移的情況轉移」。

---
解法二：使用 `std::forward`

C++11 為了這個問題設計了 *std::forward*，它能根據模板推導結果「保留原始值屬性」：

```cpp
template <typename T>
void relay_perfect(T&& arg) {
    process(std::forward<T>(arg));
}
```

這裡的關鍵是：

* `T&&` 是 **forwarding reference**
* `std::forward<T>(arg)` 會：

  * 若 `T` 是普通型別（如 `int`）→ 轉為右值（rvalue）
  * 若 `T` 是參考型別（如 `int&`）→ 保留為左值（lvalue）

---
實際測試

```cpp
int main() {
    int i = 42;

    relay_perfect(i);     // 傳左值
    relay_perfect(99);    // 傳右值
}
```

輸出：

```
process(int&): lvalue version
process(int&&): rvalue version
```

完美！左值仍是左值、右值仍是右值。

---

用程式碼觀察推導過程

如果你在 `relay_perfect` 裡加一行：

```cpp
cout << boolalpha;
cout << "is lvalue: " << is_lvalue_reference<T>::value << '\n';
```

結果會顯示：

```
is lvalue: true   // 當傳入 i 時，T 被推導成 int&
is lvalue: false  // 當傳入 99 時，T 被推導成 int
```

這正是 `std::forward` 能區分的關鍵依據。

---
結論

- `std::move`：**無條件**轉成右值。
- `std::forward`：**有條件**轉成右值（保留原始值屬性）。
- `T&&` + `std::forward` = 「完美轉發」機制的靈魂組合。

---
## 結語：模板推導讓 C++ 有了「型別的自我意識」

**Template Argument Deduction** 是 C++ 模板系統的靈魂。
從最早的函式推導、到 `decltype`、`type_traits`、再到 `std::move`、`std::forward`，
整個機制都是建立在「編譯期型別邏輯」之上。

理解 TAD，不只是為了少踩坑；
更是理解現代 C++ 如何在「泛型」與「型別安全」之間達成平衡的關鍵。

---
以上整篇說到的型別推導規則都是用於**function templates**，下一篇會講到C++17的**Class template argument deduction (CTAD)**。
C++17 讓TAD不再只屬於 *function templates*，*class template* (類別模板)也能自動推導型別參數。
