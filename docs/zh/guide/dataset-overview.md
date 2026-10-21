# 数据集基本信息查看

本文介绍SpatialXomics中数据集详情页的基本信息构成，以及如何下载原始数据、生成并复制分享链接、将数据集设为公开。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 操作说明

### 1. 进入数据基本信息页面

点击所需查看的数据集，会在新标签页打开基本信息页面。

![image-20260908164356627](https://cdn.neonexus.top/docs/20260908164356724.jpg_view)



### 2. 基本信息说明

数据集基本信息如图，后续将对各部分进行说明。

![image-20260908164615804](https://cdn.neonexus.top/docs/20260908164615849.jpg_view)



#### 2.1 Biological & Sample Info（生物学及样本信息）

该部分罗列了一些生物学及样本信息。

![image-20260914194520246](https://cdn.neonexus.top/docs/20260914194520307.jpg_view)

信息解读如下：

| 字段                    | 信息                                    | 中文解读                                          |
| ----------------------- | --------------------------------------- | ------------------------------------------------- |
| **Organism**            | Mouse (mus musculus)                    | 物种：**小鼠**（学名 *mus musculus*）             |
| **Organism Part**       | Brain                                   | 组织/器官部位：**大脑**                           |
| **Condition**           | Control                                 | 实验条件：**对照组**（未处理/正常样本）           |
| **Growth Conditions**   | —                                       | 生长条件：**未填写**                              |
| **Stabilization**       | Ffpe (formalin-fixed paraffin-embedded) | 固定保存方式：**福尔马林固定 + 石蜡包埋**（FFPE） |
| **Tissue Modification** | —                                       | 组织修饰：**未填写**                              |



#### 2.2 MSI Analysis Settings（质谱成像分析设置）

该部分罗列了质谱成像分析设置。

![image-20260914194545811](https://cdn.neonexus.top/docs/20260914194545854.jpg_view)

解读如下：

| 字段                   | 信息                            | 中文解读                                     |
| ---------------------- | ------------------------------- | -------------------------------------------- |
| **Polarity**           | Positive                        | 离子极性：**正离子模式**                     |
| **Ionisation Source**  | MALDI                           | 离子源：**基质辅助激光解吸电离**             |
| **Analyzer**           | Orbitrap                        | 质量分析器：**轨道阱（Orbitrap）**           |
| **Pixel Size**         | 30 × 30 μm                      | 空间分辨率：**30 × 30 微米**                 |
| **Resolving Power**    | at m/z 300.2, 30000             | 在参考 m/z 处给出的分辨率；两项都未填写时显示 `at m/z 0, 0`，属正常 |
| **Matrix**             | Dhb (2,5-dihydroxybenzoic acid) | 基质：**DHB（2,5-二羟基苯甲酸）**            |
| **Matrix Application** | Spraying                        | 基质涂布方式：**喷雾法**                     |
| **Solvent**            | 100% water                      | 溶剂：**100% 纯水**                          |



#### 2.3 File Information（文件信息）

该部分罗列了文件信息。

![image-20260914194608289](https://cdn.neonexus.top/docs/20260914194608330.jpg_view)

解读如下：

| 字段              | 信息                    | 中文解读                             |
| ----------------- | ----------------------- | ------------------------------------ |
| **File Type**     | zip                     | 文件格式：**压缩包（zip）**          |
| **Experiment Type** | imzML                   | 实验数据类型：**imzML**              |
| **Size**          | 259.7 MB                | 文件大小：**259.7 MB**               |
| **Spectrum Mode** | centroid                | 谱图模式：**质心（centroid）模式**   |
| **Storage Mode**  | continuous              | 存储模式：**连续（continuous）模式** |
| **Submitted By**  | dre                     | 提交者：**dre**                      |



### 3. 下载数据集

数据集下载有两种方式，

方式一：搜索页面直接点击数据集右侧`Download`进行下载；

![image-20260908170252900](https://cdn.neonexus.top/docs/20260908170252957.jpg_view)

方式二：进入基本信息页面点击`Download`进行下载。

![image-20260914195006521](https://cdn.neonexus.top/docs/20260914195006583.jpg_view)




### 4. 分享数据集链接

公开与私有数据集均可分享，分享不会改变数据集的公开状态。

1. 进入基本信息页面，点击`Share`。
2. 链接会自动复制到剪贴板。

链接为 `/s/` 开头的短链，由数据集的 16 位 public id 构成。

![image-20260914195044109](https://cdn.neonexus.top/docs/20260914195044165.jpg_view)

### 5. 设为公开

若希望数据集出现在公开数据集中、对所有用户可见，可将其设为公开：

1. 在「我的数据集」中进入该数据集的基本信息页面（仅私有数据集显示该按钮）。

   <img src="https://cdn.neonexus.top/docs/20261008180527576.jpg_view" alt="b4788d43248812376b8046143e4b6f49" style="zoom:67%;" />

2. 点击`Make Public`，在确认弹窗中确认。

   <img src="https://cdn.neonexus.top/docs/20261008180555416.jpg_view" alt="image-20261008180555369" style="zoom: 80%;" />

数据集设为公开后不可撤销。该操作与分享相互独立：`Share`只复制链接，不会把私有数据集变为公开。