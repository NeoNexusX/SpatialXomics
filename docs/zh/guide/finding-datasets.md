# 数据查找

本文介绍SpatialXomics的公开数据集与个人数据集的搜索、筛选方式，以及数据集列表的排序模式。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 操作说明

### 1. 直接搜索查找

#### 1.1 数据集名称介绍

数据集名称在上传时根据所填元数据和文件哈希自动生成。以“0e75ee_Human_Brain_MALDI_20_Positive”为例：

“0e75ee”：文件哈希前六位；“Human”：生物体；“Brain”：取材部位；“MALDI”：离子源；“20”：像素横向尺寸；“Positive”：极性。

用户可根据需求用其中任意一段搜索查找。

![数据集命名规则](https://cdn.neonexus.top/docs/20260908161627268.jpg_view)



#### 1.2 搜索查找

用户可根据需求，在搜索状态栏直接输入需要查找的数据集名称，点击`Search`进行搜索查找。

![image-20260908162509756](https://cdn.neonexus.top/docs/20260908162509801.jpg_view)



### 2. 筛选查找

点击`Add filter`按需求选择筛选条件，再点击`Apply`即可查找目标数据集。

![image-20260914193954370](https://cdn.neonexus.top/docs/20260914193954466.jpg_view)

各筛选条件对应解释如下：

| 筛选字段                 | 对应信息               | 类型     | 选项举例                                                     |
| ------------------------ | ---------------------- | -------- | ------------------------------------------------------------ |
| **Filename**             | 平台生成的数据集文件名 | 文本输入 | 0e75ee_Human_Brain_MALDI_20_Positive                         |
| **Experiment Type**      | 实验/数据类型          | 多选     | imzML、Other                                                 |
| **提交者**               | 数据提交者的用户名     | 文本输入 | —                                                            |
| **Owner**                | 数据集拥有者           | 文本输入 | —（仅公开数据集列表显示）                                    |
| **Organism**             | 样本物种               | 多选     | Human (Homo sapiens)、Mouse (Mus musculus)、Rat、Zebrafish…  |
| **Organism Part**        | 取材部位/组织          | 多选     | Brain、Heart、Liver、Tumor、Whole organism…                  |
| **Condition**            | 样本状态/实验条件      | 多选     | Control、Disease、Cancer、Drug-treated、Genetic modification… |
| **Sample Stabilization** | 样本稳定化（保存）方式 | 多选     | Fresh、Fresh frozen、Snap frozen、FFPE、Ethanol fixed…       |
| **Sample Growth Conditions** | 样本培养条件       | 多选     | In vivo、Ex vivo、In vitro、Cell culture、Organoid…          |
| **Tissue Modification**  | 组织前处理方式         | 多选     | None、Cryosectioned、Washed、Stained、Chemical derivatization… |
| **MALDI Matrix**         | MALDI 基质             | 多选     | CHCA、DHB、NEDC、Sinapinic acid、9-AA…                       |
| **Matrix Application**   | 基质涂布方式           | 多选     | Spraying、Sublimation、Spotting、Inkjet printing…            |
| **Solvent**              | 溶剂                   | 多选     | Water、ACN、MeOH、Ethanol、TFA…                              |
| **Polarity**             | 离子极性               | 多选     | Positive、Negative                                           |
| **Ionisation Source**    | 离子源                 | 多选     | MALDI、DESI、SIMS、AP-MALDI、LDI…                            |
| **Analyzer**             | 质量分析器             | 多选     | Orbitrap Exploris 480、Q Exactive HF、timsTOF fleX、TOF…     |

「多选」字段为标签式输入：既可从词表下拉中勾选，也可自由输入；同一字段的多个取值之间为"或"的关系。「我的数据集」页不显示 Owner 筛选——该列表始终只显示你自己上传的数据集。



### 3.数据集排序方式

点击搜索状态栏右侧的排序下拉框，即可按需选择排序方式，共四种：提交时间从新到旧（默认）、提交时间从旧到新、文件大小从大到小、文件大小从小到大。

![image-20261008174924334](https://cdn.neonexus.top/docs/20261008174924392.jpg_view)

