+++
date = '2025-10-22T15:51:53+08:00'
draft = false
title = '6.S894: Accelerated Computing'
tags = ['C++', 'CUDA', 'SIMD', 'HPC']
+++

推薦MIT EECS的 [Accelerated Computing](https://accelerated-computing.academy/fall25/) 課程。
每個資工系學生都應該來上這一門課。

<!--more-->

## 前言

現代CPU/GPU性能強大，但軟體相比之下還有很大進步空間。

這堂課目的就是，如何針對硬體寫出高效程式。
上課影片檔案在Youtube上面看得到，但前面聲音有點小聲，於是我乾脆轉成逐字稿再給LLM生成摘要，搭配投影片一起看。

## 作業一定要做

目前只做到Lab3，學到不少東西，需要一些時間去消化知識。

例如Lab1，從基本的CPU版本開始，利用SIMD指令集(Intel AVX)去改寫程式，因為一次抓取512 bytes，效能理論上可以增加16倍。

以及GPU版本用CUDA開發。從一開始一個 warp 只有1個 thread 開始到32個 thread。
以前寫程式想法就是單執行緒的想法去實作的，對於平行的資料處理，思維很不同。

---
Lab2 開始就是Data-Level / Instruction-Level / Thread-Level Parallelism, 循序漸近一步一步優化, 實驗不同的參數組合, 分析跑出來的數據瓶頸在哪。

Lab3 則是從記憶體延遲角度去改善程式效能。
之後慢慢來分享每個作業。

## 參考資料

這裡列出其他也很有學習價值的課程或是線上教材。

- [國立清華大學開放式課程 - 平行程式(周志遠 教授)](https://ocw.nthu.edu.tw/ocw/index.php?page=course&cid=231&)
- [Algorithms for Modern Hardware](https://en.algorithmica.org/hpc/)
- [Highway](https://github.com/google/highway) - A C++ library that provides portable SIMD/vector intrinsics


