+++
date = '2025-10-21T22:07:33+08:00'
draft = false
title = 'C++17: Class Template Argument Deduction'
tags = ['C++', 'Template', 'CTAD']
+++

C++17 引入了 Class Template Argument Deduction (CTAD)，讓編譯器能自動推導模板類別的型別參數，不用再手動指定 `<T>`。
像是 `std::vector v{1,2,3}` 就能自動推導為 `std::vector<int>`，不用再手動指定型別，寫起來更簡潔直觀。

<!--more-->

## 模板型別終於不用再手動指定

還記得以前寫 `std::pair<int, double> p(1, 3.14);` 嗎？
那個 `<int, double>` 每次都得自己補上去，寫久真的會有點煩。

從 **C++17** 開始，終於有了個更聰明的功能：
**Class Template Argument Deduction (CTAD)**。

有了 CTAD 之後，編譯器可自動根據建構子參數推導出型別參數，
所以我們現在可以寫成：

```cpp
std::pair p(1, 3.14); // 自動推導為 std::pair<int, double>
```

是不是瞬間清爽很多?
連 `std::vector` 都能這樣用：

```cpp
std::vector v{1, 2, 3}; // 自動推導成 std::vector<int>
```

CTAD 讓程式碼更簡潔、可讀性更高，尤其在泛型程式設計與現代 C++ 開發中相當實用。

---
## CTAD 是怎麼運作的？

當呼叫一個模板類別的建構子時，編譯器會根據建構子的參數自動「反推出」類別的型別參數。
舉例來說：

```cpp
std::pair p(42, 3.14);
```

編譯器根據建構子參數 `(int, double)`，推導出類型應該是 `std::pair<int, double>`。
這過程就叫做 **class template argument deduction**。


### 標準容器也支援 CTAD

像 `std::vector`, `std::pair`, `std::map`, `std::set` 都已經支援自動推導了，
可以從初始化列表自動推導類型。

```cpp
// C++17 以前
std::vector<int> vec{1, 2, 3};
std::pair<int, std::string> p{42, "hi"};

// C++17 CTAD
std::vector vec{1, 2, 3};   // 自動變成 std::vector<int>
std::pair p{42, "hi"};      // 自動變成 std::pair<int, const char*>
```

看起來小改變，卻讓模板寫起來順手許多。

---
### 迭代器範圍也能推導？是的!

CTAD 甚至能從迭代器範圍自動推導元素型別，例如：

```cpp
std::set unique_set{source.begin(), source.end()}; // 推導為 std::set<int>
```

為什麼它能推得出來？
因為標準庫偷偷幫我們寫好了**推導指引**(deduction guide)：

```cpp
template <class InputIt>
set(InputIt, InputIt) -> set<typename std::iterator_traits<InputIt>::value_type>;
```

這段意思是：

如果你用兩個 iterator 來建構 set，那就把 iterator 指向的 `value_type` 當成元素型別。
所以只要 `source` 是 `std::vector<int>`，那結果就會是 `std::set<int>`。

> 備註: 關於 `iterator_traits`，會另外有一篇文章完整地說明。

---
### 但等等，為什麼 vector 不行?

來看個陷阱(這是很多人第一次用 CTAD 會遇到的問題)：

```cpp
std::vector<int> source{1, 2, 3, 4, 5, 6, 7, 8, 9, 10};

// vector 用花括號會編譯失敗
std::vector subset1{source.begin() + 2, source.begin() + 7};

// 但 set 卻可以
std::set unique_set{source.begin(), source.end()};

// vector 改用圓括號就成功了
std::vector subset2(source.begin() + 2, source.begin() + 7);
```

這是怎麼回事？

---
## C++17 CTAD 的重要陷阱：花括號 vs 圓括號

關鍵在於 C++ 的**初始化優先順序規則**。
### 根本原因：花括號會優先匹配 initializer_list

當使用花括號 `{}` 初始化時，C++ 會**優先嘗試** `initializer_list` 建構子。

`std::vector` 有兩個相關建構子：

```cpp
// 1. initializer_list 建構子(優先級高)
template<typename T>
vector(std::initializer_list<T> init);

// 2. 迭代器範圍建構子
template<typename Iterator>
vector(Iterator first, Iterator last);
```

---
### vector 為何失敗？

```cpp
std::vector subset{source.begin(), source.end()};
```

編譯器看到花括號 `{}`，會優先嘗試使用 `initializer_list` 建構子。
因此它誤以為 `{iter1, iter2}` 是**兩個元素**的列表，而不是**一個範圍**。
也就是說，編譯器試圖建構一個 `std::vector<iterator>`，但語義不合理，最終導致編譯失敗。

---
改用圓括號 `()` 就成功：

```cpp
std::vector subset(source.begin(), source.end());
```

跳過 `initializer_list`，直接使用迭代器建構子，推導為 `vector<int>`

---
### 為什麼 std::set 用花括號也可以？

```cpp
std::set unique_set{source.begin(), source.end()};
```

`std::set` 的 `initializer_list` 建構子定義不同：

```cpp
template<typename Key>
set(std::initializer_list<Key> init);  // 要求元素是 Key 類型(int)
```


編譯器看到花括號 `{}`：
1. 編譯器首先嘗試 `initializer_list<int>` 建構子，但發現傳入的是 iterator，並非 `int`。
2. 類型不匹配，因此放棄使用 `initializer_list`。
3. 接著改用「迭代器範圍」的建構子，成功推導為 `set<int>`。

而 `std::vector` 的情況不同：

* `vector` 的 `initializer_list` 建構子接受任意類型 `T`(包括 iterator)，導致編譯器誤以為 `{iter1, iter2}` 是元素列表。
* 相對地，`set` 的 `initializer_list` 建構子要求元素類型必須是 `Key`(例如 `int`)，因此 iterator 類型無法匹配，編譯器自然會跳過。

---
### 實際範例與解決方案

```cpp
std::vector<int> source{1, 2, 3, 4, 5, 6, 7, 8, 9, 10};

// 錯誤：花括號會嘗試用 initializer_list
std::vector subset1{source.begin() + 2, source.begin() + 7};

// 方案 1：使用圓括號
std::vector subset2(source.begin() + 2, source.begin() + 7);

// 方案 2：明確指定類型
std::vector<int> subset3{source.begin() + 2, source.begin() + 7};

// set 沒有這個問題，兩種都可以
std::set unique_set1{source.begin(), source.end()};  // 推導為 set<int>
std::set unique_set2(source.begin(), source.end());  // 推導為 set<int>
```

---
### 實用建議

何時用花括號 `{}`？
- 元素初始化列表：`vector<int> v{1, 2, 3}`;
- set/map (不會混淆): `set s{1, 2, 3}`;

何時用圓括號 `()`？
- 迭代器範圍建構：`vector v(begin, end)`;
- 避免歧義時

記憶口訣：
迭代器建構用圓括號，元素列表用花括號

---
## 自訂類別也能用 CTAD !

C++17 的 CTAD (Class Template Argument Deduction)不只內建容器能用，
連你自己寫的模板類別也能享受到自動推導的好處。

### 基本範例

```cpp
template<typename T, typename U>
class MyPair {
public:
    T first;
    U second;

    MyPair(T f, U s) : first(f), second(s) {}
};

MyPair pair1{42, "hello"};   // 推導為 MyPair<int, const char*>
MyPair pair2{3.14, 100};     // 推導為 MyPair<double, int>
```

完全不需要寫 `<int, const char*>`。
只要建構子的參數能夠透露型別資訊，編譯器就會自動幫你推導。

---
### 進階：自訂推導指引(Deduction Guide)

不過有時候，編譯器並不一定「猜得中」。這時就可以手動告訴它該怎麼推導。

```cpp
template<typename Iterator>
class Container {
public:
    Container(Iterator begin, Iterator end) {}
};

// 告訴編譯器：
// 當看到 Container(iter1, iter2) 時，
// 請把它推導成 Container<iterator_traits<Iterator>::value_type>
template<typename Iterator>
Container(Iterator, Iterator)
    -> Container<typename std::iterator_traits<Iterator>::value_type>;
```

這行就是所謂的**推導指引**。意思是：
「當你看到兩個 iterator 當參數時，請用 iterator 指向的元素型別來決定 Container 的模板參數」。

實際例子：

```cpp
std::vector<int> vec{1, 2, 3};
Container c(vec.begin(), vec.end());  // 推導為 Container<int>
```

整個過程就是：

* 編譯器看到 `Container(iter1, iter2)`
* 檢查我們提供的推導指引
* 發現 iterator 指向 `int`
* 於是推導出 `Container<int>`

這樣就能在泛型程式中保持漂亮又安全的型別推導。

---
如果要更細節一點地說明:

推導過程

1. 編譯器看到：`Container(vec.begin(), vec.end())`
2. 匹配推導指引：`Container(Iterator, Iterator)`
3. `Iterator = std::vector<int>::iterator`
4. 查找 `std::iterator_traits<std::vector<int>::iterator>::value_type`
5. 得到 `int`
6. 最終推導：`Container<int>`

---
### 陷阱與限制

雖然 CTAD 很強，但也有幾個限制要注意：

- 空初始化不行：`std::vector v{};` 編譯器無法推導類型
- 混合型別會出錯：`std::vector v{1, 2.5};` → 無法決定 `int` 還是 `double`
- 有些情況還是得明確指定類型（特別是模板巢狀的情況）

---
### 結語：CTAD 是 C++17 的一小步，但開發體驗的一大步

在泛型程式設計裡，CTAD 幫我們拿掉了那些重複又冗長的 `<T>`。
它不是什麼革命性的語法糖，但在日常開發中卻超實用。

