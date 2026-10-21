# 上传数据

本文介绍SpatialXomics中 imzML/ibd 文件对的上传流程与元数据填写规范，以及自动查重、分片上传与断点续传机制。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 操作说明

### 1. 上传数据

点击`Upload New Dataset`即可打开上传弹窗。

![image-20260908174622341](https://cdn.neonexus.top/docs/20260908174622409.jpg_view)

上传弹窗如图，详细操作流程如下。

![image-20260908174725003](https://cdn.neonexus.top/docs/20260908174725075.jpg_view)

#### 1.1 选择本地文件

点击 `Choose Files` 后选择本地的 .imzML 和 .ibd 文件进行上传，要求两文件必须同名。

![image-20260908175048625](https://cdn.neonexus.top/docs/20260908175048689.jpg_view)

#### 1.2 勾选数据集是否公开

可选择上传数据集是否公开，默认勾选。公开数据集的 IBD 文件须不小于 **10 MB**。

![公开设置](https://cdn.neonexus.top/docs/20260908175221284.jpg_view)



#### 1.3 填写数据基本信息

其中*为必填项。Spectrum Mode 与 Storage Mode 会从 imzML 文件头自动读取并预填，修改时需确认。

![元数据表单](https://cdn.neonexus.top/docs/20260908193210320.jpg_view)

下面对各信息填写做一简单介绍：

##### 1.3.1 质谱成像分析参数

| 字段                         | 类型       | 说明                     | 可选值/规则                                                  |
| ---------------------------- | ---------- | ------------------------ | ------------------------------------------------------------ |
| **Polarity**                 | 必填       | 离子极性                 | `Positive` / `Negative`                                      |
| **Ionisation Source**        | 必填       | 离子源                   | **MALDI**类、**DESI**类以及其余类别，不同类别后续所需填写的字段不同，详细见动态条件字段 |
| **Analyzer**                 | 必填       | 质量分析器               | `Orbitrap Exploris 480/240/120`, `Q Exactive HF`, `timsTOF fleX`, `Orbitrap`等 |
| **Pixel Size X (μm)**        | 必填       | 像素横向尺寸             | 整数，**1–200** μm                                           |
| **Pixel Size Y (μm)**        | 必填       | 像素纵向尺寸             | 整数，**1–200** μm                                           |
| **Spectrum Mode**            | 必填       | 谱图模式                 | `profile`（连续谱） / `centroid`（质心谱）                   |
| **Storage Mode**             | 必填       | imzML 存储模式           | `continuous` / `processed`                                   |
| **Solvent**                  | 根据离子源 | 溶剂组成                 | 预填 `100% Water`；可选 `Water`, `ACN`, `MeOH`, `Ethanol`, `IPA`, `Acetone`等 |
| **MALDI Matrix**             | 根据离子源 | MALDI 基质               | `CHCA`, `DHB`, `NEDC`, `Sinapinic acid`, `9-AA`, `Norharmane`, `DAN` 等 |
| **MALDI Matrix Application** | 根据离子源 | 基质涂布方式             | `Spraying`, `Airbrush`, `Automated sprayer`, `Sublimation`, `Spotting`等 |
| **m/z**                      | 选填       | 检测器分辨率对应的质荷比 | 数字                                                         |
| **Resolving Power**          | 选填       | 分辨率数值               | 数字                                                         |

特别指出动态条件字段（是否必填取决于**Ionisation Source**）：

| 离子源家族                                                   | Solvent | MALDI Matrix | MALDI Matrix Application |
| ------------------------------------------------------------ | ------- | ------------ | ------------------------ |
| **MALDI** / **MALDI-2** / **AP-MALDI** / **AP-SMALDI**       | ✅ 必填  | ✅ 必填       | ✅ 必填                   |
| **DESI** / **nano-DESI** / **IR-MALDESI**                    | ✅ 必填  | ❌ 选填       | ❌ 选填                   |
| **SIMS** / **LDI** / **SALDI** / **LAESI** / **Other** / 未选择 | ❌ 选填  | ❌ 选填       | ❌ 选填                   |



##### 1.3.2 样本与实验信息

| 字段                         | 类型 | 说明              | 可选值                                                       |
| ---------------------------- | :--- | ----------------- | ------------------------------------------------------------ |
| **Organism**                 | 必填 | 物种              | `Human`, `Mouse`, `Rat`, `Zebrafish`, `Fruit fly`, `Arabidopsis`等 |
| **Organism Part**            | 必填 | 取材部位          | `Brain`, `Heart`, `Liver`, `Lung`, `Kidney`, `Spleen`, `Pancreas`等 |
| **Condition**                | 必填 | 样本状态/实验条件 | `Control`, `Disease`, `Cancer`, `Infection`, `Drug-treated`, `Genetic modification`等 |
| **Sample Stabilization**     | 必填 | 样本稳定化处理    | `Fresh`, `Fresh frozen`, `Snap frozen`, `FFPE`, `Fixed (formalin)`等 |
| **Sample Growth Conditions** | 选填 | 样本培养条件      | `In vivo`, `Ex vivo`, `In vitro`, `Cell culture`, `2D culture`, `3D culture`等 |
| **Tissue Modification**      | 选填 | 组织修饰/前处理   | `None`, `Sectioned`, `Cryosectioned`, `Microdissected`, `Washed`, `Digested`, `Stained`等 |



### 2. 上传过程说明

上传完全在浏览器内完成，并分片直传阿里云 OSS，单次上传的源文件总大小上限为 **100 GB**：

1. Web Worker 计算源文件 MD5 并询问服务端是否已有相同内容，命中则直接复用已存副本。
2. 未命中时先获取临时 STS 凭证并初始化分片上传。
3. 文件对一边被压缩为 ZIP64 一边逐片上传，压缩产物不落盘。
4. 信用闸门、分片队列与并发调度器共同限制内存占用，并按实测瓶颈动态调整上传并发。
5. **上传进度**面板展示进度、速度与单片重试。某个分片重试耗尽会停止流水线，并保留可续传会话。

上传中断后可在上传弹窗顶部的续传横幅中继续。会话保存在 `localStorage` 的固定键 `oss_upload_session_v2` 下（单槽位，同一时刻只保留一份），记录数据集 public id、源文件名与压缩参数——续传必须重新产出字节完全一致的压缩包。发起新的上传会覆盖已有会话。旧版本遗留的会话会被清理而不是迁移。

### 3. My Datasets

数据集上传成功后，可在`Datahub`—`My Datasets`中查看，数据集基本信息查看功能详细见[数据集总览](./dataset-overview)。

![image-20260908203828331](https://cdn.neonexus.top/docs/20260908203828434.jpg_view)



