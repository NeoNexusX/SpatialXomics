# 快速开始

SpatialXomics 是一个对质谱成像（MSI）数据进行管理、分析与可视化的平台。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 概述

质谱成像数据文件体积庞大，且往往分散在不同仪器与个人电脑中。研究人员在管理与分析这些数据时，通常需要自行搭建本地环境、在多个工具之间切换，面临数据难以共享、流程难以复现、结果难以直观展示等问题。

SpatialXomics 将常用的 MSI 数据管理与分析功能整合到同一套 Web 平台中。使用者只需要通过浏览器上传 imzML/ibd 数据并填写元数据，即可完成数据集管理、预处理配置、结果可视化和区域分析，无需安装任何本地软件。

它适合：

- 希望集中管理、共享和下载 imzML 数据集的 MSI、代谢组学和质谱研究人员；
- 希望在线执行降噪、基线校正、归一化、峰提取或峰对齐等预处理的用户；
- 希望进一步查看离子图与平均谱、进行注释匹配或 UMAP/KMeans 组织区域划分的用户。



## 功能

- **账号与权限** —— 支持注册、登录、找回密码和个人资料维护，管理员可管理平台用户。
- **数据上传** —— 导入配对的 .imzML 和 .ibd 文件，自动查重、压缩并分片上传，支持断点续传。
- **数据集管理** —— 浏览公开数据集、管理个人数据集，查看元数据、分享公开详情页并下载原始文件。
- **数据集合** —— 把相关公开数据集组织成带学术元数据和有序成员列表的数据集合。
- **预处理分析** —— 按数据的 spectrum/storage mode 展示兼容的噪声抑制、基线校正、强度归一化、峰提取和峰对齐方法，配置参数后提交任务。
- **结果可视化** —— Continuous 数据查看离子图与平均谱，Processed 数据查看 TIC 图与逐像素谱；支持调节显示范围、Gamma、配色与 TIC 归一化，可导出透明背景 PNG。
- **空间分析** —— 查看离子图，使用 UMAP/KMeans 辅助观察不同组织区域；支持聚类筛选、矩形/自由形状 ROI 和多区域组合比较。
- **注释匹配** —— 导入 CSV 注释表，以 ppm 或 Da 容差匹配 m/z，支持筛选、导出和 PubChem 化合物查询。



## 快速上手步骤

### 1. 进入网页

点击`Join to start`进入 SpatialXomics 操作页面.

![image-20260907165610757](https://cdn.neonexus.top/docs/20260907165610863.jpg_view)



### 2. 注册与登录

首次使用用户进行账号的注册（详细操作见[账户管理](./account-management)），完成后点击`Sign in`登录。

![登录页面](https://cdn.neonexus.top/docs/20260907165825552.jpg_view)



### 3. 查找数据

根据个人需求采取搜索或筛选查找数据（详情见[查找数据集](./finding-datasets)）。

此处采用筛选查找出”Mouse Brain”数据。首先点击`Add filter`进行筛选，再将筛选条件设置为”Mouse”、”Brain”，最后点击`Apply`得到筛选查找的结果。

![筛选示例](https://cdn.neonexus.top/docs/20260907174909406.jpg_view)

### 4. 查看数据基本信息并下载

点击所需数据的状况栏可查看数据的基本信息；

![image-20260907175815083](https://cdn.neonexus.top/docs/20260907175815189.jpg_view)

“Mouse_Brain_MALDI_30_Positive_7d5b0c”数据的基本信息如下（详细基本信息解读见[数据集总览](./dataset-overview)）。

（“Mouse”：生物体信息；“Brain”：有机体部分；“MALDI”：离子源；“30”：像素尺寸；“Positive”：极性；“7d5b0c”：识别码）用户可根据需求快速搜索查找。

特别指出点击该页面`Download`按钮可下载该数据集，点击`Share`可分享该数据集链接。

![image-20260907180028409](https://cdn.neonexus.top/docs/20260907180028501.jpg_view)

### 5. 数据可视化

点击`Visualize`即可查看数据集具体信息（具体细节介绍见[数据可视化](./data-visualization)）。

![image-20260908134626345](https://cdn.neonexus.top/docs/20260908134626454.jpg_view)

![image-20260908135003273](https://cdn.neonexus.top/docs/20260908135003414.jpg_view)

上述内容是对公开数据集进行寻找查看下载等操作，下面我们介绍如何上传私人的数据集并进行处理。

### 6. 上传数据

点击`Upload New Dataset`即可上传本地数据集；

![image-20260908135743140](https://cdn.neonexus.top/docs/20260908135743254.jpg_view)

点击`Choose Files`即可选择本地数据集，并按要求完成基本信息填写便于后续分析（详细操作见[上传数据集](./upload-data)），其中*为必填项。

（注意：上传数据需是 .imzML 以及其配套 .ibd 文件）

![image-20260908140402607](https://cdn.neonexus.top/docs/20260908140402663.jpg_view)

上传成功后数据可在`Datahub`—`My Datasets`中查看，信息查看功能与上述3-5步操作一致。

![image-20260908140630704](https://cdn.neonexus.top/docs/20260908140630805.jpg_view)

### 7. 分析数据

点击`Workspace`—`New Analysis`进入数据分析页面，选择所需分析的数据集和功能进行分析（详细操作见[数据集分析](./dataset-analysis)）。

此处以公开数据集中”Mouse_Kidney_MALDI_30_Negative_77bf5d”为例，进行了降噪、基线校正、强度归一化、峰提取、峰对齐的分析操作。

![新建分析页面](https://cdn.neonexus.top/docs/20260908141557982.jpg_view)

点击`Start Analysis`后会自动进入`Workspace`—`Workspace`页面，也可自行手动操作进入该页面，查看数据处理情况(具体细节见[工作区](./workspace))。

![工作区页面](https://cdn.neonexus.top/docs/20260908142155682.jpg_view)



## 下一步

在完成快速开始中的步骤后，你可以根据实际需求，选择阅读以下专题文档：

| 文档 | 内容 |
|---|---|
| [账户管理](./account-management) | 注册、登录、找回密码、个人资料与权限管理 |
| [查找数据集](./finding-datasets) | 搜索、筛选、排序公开和私有数据集 |
| [数据集总览](./dataset-overview) | 元数据字段、下载原始文件、生成分享链接 |
| [数据可视化](./data-visualization) | 离子图、TIC 图、质谱、UMAP/KMeans、ROI、区域比较、注释匹配 |
| [上传数据集](./upload-data) | imzML/ibd 上传流程、元数据表单、查重、断点续传 |
| [数据集分析](./dataset-analysis) | 选择兼容的预处理方法、参数配置、提交任务 |
| [工作区](./workspace) | 任务面板、状态跟踪、查看结果 |
| [导航说明](./navigation) | 导航栏与悬浮导航球 |
| [数据集合](./collections) | 浏览与创建数据集合、成员管理、公开分享 |

