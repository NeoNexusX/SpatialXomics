# 工作区

本文介绍工作区页面的整体布局、任务列表与状态跟踪，以及分析结果与失败信息的查看入口。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 操作说明

### 1. 进入 Workspace 页面

点击导航栏`Workspace`—`Workspace`进入工作区页面。

![image-20260909173325329](https://cdn.neonexus.top/docs/20260909173325409.jpg_view)



### 2. 页面功能介绍

页面可简单分为导航栏、跳转按钮、新建工作按钮、工作进度区。后文将对各模块进行详细介绍。

![image-20260909173705142](https://cdn.neonexus.top/docs/20260909173705219.jpg_view)

#### 2.1 跳转按钮

点击`Go to MyDatasets`即可跳转至My Datasets页面，页面详细介绍见[上传数据集](./upload-data)。

![image-20260909174025428](https://cdn.neonexus.top/docs/20260909174025496.jpg_view)



#### 2.2 创建工作按钮

点击`New Task`即可跳转至New Analysis创建新的数据分析工作，详细创建流程见[数据集分析](./dataset-analysis)。

![image-20260909174235405](https://cdn.neonexus.top/docs/20260909174235481.jpg_view)



#### 2.3 工作进度区

该部分显示了历史创建的数据分析工作以及正在进行的数据分析工作。

以下图为例，可知目前0个数据集正在分析，4个数据集已成功分析，0个数据集分析失败。

![image-20260909174322541](https://cdn.neonexus.top/docs/20260909174322612.jpg_view)

任务表每行包含以下列：

| 列名 | 说明 |
| --- | --- |
| **Process** | 任务标识 |
| **Dataset** | 被分析的数据集 |
| **Methods** | 该任务使用的预处理方法 |
| **Created** | 任务提交时间 |
| **Finished** | 任务完成时间（仍在运行时为空） |
| **Status** | Running、Completed 或 Failed |
| **View** | 在可视化工作台打开该结果 |
| **Delete** | 确认后删除该结果 |

分析失败的任务可展开错误详情，查看失败原因。搜索框支持按数据集名称筛选任务。
