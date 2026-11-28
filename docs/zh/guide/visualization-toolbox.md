# 可视化工具箱

Toolbox 位于数据集可视化页面右侧。默认收起为窄条，点击顶部的 `Toolbox` 展开或收起；其中的各区块默认收起，点击区块标题展开，标题或参数旁的 ⓘ 图标可查看说明（按 Esc 关闭）。

返回[数据可视化](./data-visualization)。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/SpatialXomics/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。

## 数据集信息 Info

显示数据集元数据：Polarity（极性）、Analyzer（质量分析器）、Ionisation Source（离子源）、Pixel Size（像素尺寸）、Resolving Power（分辨率）、Matrix（基质）、Matrix Application（基质涂布方式）、Solvent（溶剂）、Spectrum Mode（谱图模式）、Storage Mode（imzml 存储模式）。

下方的 **Biological & Sample Info（生物与样本信息）** 显示上传时填写的样本信息：物种、组织部位、实验条件、培养条件、稳定化处理、组织前处理。

这些信息取自源数据集，预处理后的结果同样会显示；上传时未填写的字段不显示。区块末尾的 **Preprocessing（预处理）** 列出该结果使用的处理方法，如 “Direct conversion (no preprocessing)”。

![数据集信息](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160527037.jpg_view)

## 强度设置 Intensity

- **强度直方图**：可视化强度分布，红线标记当前 Min/Max。
- **Dimensions**：图像尺寸（如 100 × 80）。
- **Non-zero**：非零像素数量。
- **TIC**：总离子流。
- **Max / Min**：直接输入数值，右侧实时显示当前值对应的**百分位**（如 “95.23%”）。
- **Gamma 校正**：滑块范围 0.5–1.5，默认 1.0，调整图像亮度/对比度曲线。

图像右侧强度条的操作见[数据可视化 > 离子强度图 > 强度调节](./data-visualization#强度调节)。

![强度设置](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160548178.jpg_view)

## 多离子叠加 Multi-ion overlay

（仅 Continuous）Continuous 数据可将多个离子同时叠加为多个颜色通道显示。开启 `Overlay mode` 后，可将当前 m/z 添加为一个通道；也可使用 `Batch add m/z`，直接在谱图上点击峰批量添加。

- 最多支持 **10 个通道**，每个通道按各自的强度范围独立归一化后叠加为不同颜色；
- 每个通道可单独控制可见性、颜色与透明度；
- 叠加激活时，Display Range、Colormap 与 Gamma 控件均会置灰（叠加渲染不使用这些设置）。

![多离子叠加](https://cdn.neonexus.top/docs/20261008180949956.jpg_view)

## 聚类 Clustering

（仅 Continuous）UMAP / KMeans 降维聚类；首次开启需确认，后端创建 UMAP 计算任务。

先保存 ROI（或导入掩膜），再在 Clustering 区块的 `Scope` 中选择它：KMeans 只对该 ROI 内的像素聚类；选择 `All pixels` 则对全图聚类。所选 ROI 内可聚类像素少于 2 个时无法运行。

| 功能                   | 说明                                                  |
| ---------------------- | ----------------------------------------------------- |
| **Enable UMAP/KMeans** | 首次开启需确认，后端创建 UMAP 计算任务                |
| **UMAP**               | 显示 UMAP 降维嵌入的二维分布覆盖层                    |
| **KMeans**             | 在 UMAP 基础上做 KMeans 聚类（k=2–20)，本地浏览器计算 |
| **Scope**              | 选择某个 ROI 时只对该 ROI 内的像素聚类，选择「全部像素」则对全图聚类；所选 ROI 少于 2 个像素时无法聚类并给出提示 |
| **Opacity**            | 分别调节 UMAP/KMeans 覆盖层透明度                     |
| **Export PNG**         | 导出 UMAP/KMeans 图像                                 |
| **Cluster 筛选**       | 勾选/取消特定 cluster，控制显示范围                   |

在 Clustering 区块开启并运行 KMeans，然后选择聚类层数得到聚类结果：

![KMeans 控件](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162239718.jpg_view)

![聚类结果](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162317073.jpg_view)

![聚类覆盖层](https://cdn.neonexus.top/docs/20260914160853673.jpg_view)

**UMAP 图：**

![UMAP 图](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160627242.jpg_view)

**KMeans 图：**

![KMeans 图](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160720811.jpg_view)

得到聚类后，可在[数据可视化 > 区域比较](./data-visualization#区域比较)中把不同的聚类分别勾选到 A/B 组进行比较。

## 感兴趣区域 ROI

ROI 先在草稿里由一个或多个形状组合而成，保存后进入 ROI 列表。

| 功能                              | 说明                                                                 |
| --------------------------------- | -------------------------------------------------------------------- |
| **Rect / Ellipse**                | 在离子图上拖动绘制矩形或椭圆（按住 Shift 画正圆）；确认前可拖动角点调整、拖动中心移动 |
| **Segments**                      | 逐点单击连成多边形，点击起点或按 Enter 闭合                          |
| **Freehand**                      | 拖动描边，松手暂停，从末端续画；点击起点或按 Enter 闭合              |
| **Collect**                       | 按当前离子图选取有信号或无信号的像素，或全部已采集的像素             |
| **Add / Subtract / Intersect**    | 新形状与草稿的组合方式：并入、减去、取交集                           |
| **Use an existing region**        | 把已保存的 ROI 或 KMeans 聚类作为一个形状加入草稿                    |
| **Confirm shape / Discard shape** | 确认或丢弃当前形状，确认后才会更新草稿                               |
| **Undo / Redo**                   | 撤销或重做草稿的一步（Ctrl/⌘+Z、Shift+Ctrl/⌘+Z）                     |
| **Save ROI / Cancel draft**       | 把草稿保存为 ROI，或放弃整个草稿                                     |
| **ROI 列表**                      | 勾选的 ROI 按各自颜色填充到图上并纳入导出掩膜，可单独调节不透明度；每个 ROI 显示像素数与 Mean、Std、Min、Max |
| **ROI only / Show all**           | 切换：只显示 ROI 区域 或 显示完整图像                                |
| **管理**                          | 删除单个 ROI 或 Clear all                                            |

**四种 ROI 绘制工具**，用户可以自行选择合适的工具：（也可按当前离子图选取有信号或无信号的像素，或全部已采集的像素）

![ROI 绘制工具](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160910260.jpg_view)

此外，用户可以根据需要自由组合 ROI，工具支持绘制图形后的**合并、减去以及取交集**，最终保存成需要的 ROI。如：

下图是左侧矩形删去右侧椭圆形后的 ROI：

![ROI 组合前](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127161821957.jpg_view)

保存后为：

![ROI 组合保存后](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127161855527.jpg_view)

保存 ROI 后，可在[数据可视化 > 区域比较](./data-visualization#区域比较)中把不同的 ROI 分别勾选到 A/B 组进行比较。

## 区域掩膜 Region masks

可将 ROI 与 KMeans 聚类结果导出为二值掩膜文件，也可把掩膜文件导入为 ROI。

| 功能                            | 说明                                                         |
| ------------------------------- | ------------------------------------------------------------ |
| **Format**                      | 选择掩膜文件格式（.npz / .csv）                              |
| **导出列表**                    | ROI 列表中勾选的 ROI，以及 KMeans 显示时勾选的聚类，合并为一个二值掩膜 |
| **Export mask**                 | 导出一个掩膜文件，文件内嵌数据集名称、形状、像素尺寸与像素数据的 SHA-256 校验值 |
| **Import mask**                 | 导入掩膜文件，每个文件成为 ROI 列表中的一项（标签为「导入」），用法与手绘 ROI 相同 |

用户可以自行勾选需要的 ROI 或者聚类结果进行导出，如下图是选择 ROI2、Cluster2、Cluster3：

![区域掩膜导出选择](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162130003.jpg_view)