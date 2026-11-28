# 数据可视化

本文介绍数据集离子强度图、像素谱图和区域比较的操作。数据集需要先完成预处理，处于 Visualize 状态后才能进入。

- 左侧注释面板的详细操作见[数据注释](./data-annotation)。
- 右侧 Toolbox 的详细操作见[可视化工具箱](./visualization-toolbox)。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/SpatialXomics/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。

## 数据集状态

数据集封面主要会呈现两种形式：“Explore” 和 “Visualize”。

![image-20260909211924082](https://cdn.neonexus.top/docs/20260909211924161.jpg_view)

当数据集处在 “Explore” 时，此时数据集还在待处理阶段，还无法查看可视化结果，需点击 `Explore` 后再选择 `Generate` 创建数据预处理任务，创建成功后，将自动跳转至 Workspace 页面，页面具体信息见[工作台](./workspace)。

![image-20260909212549202](https://cdn.neonexus.top/docs/20260909212549240.jpg_view)

当数据集处在 “Visualize” 时，此时数据集已经过预处理，点击 `Visualize` 即可跳转至数据可视化页面，直接查看可视化结果。

## 页面布局

可视化页面主要分为五个区域：

- **离子强度图**（中央）：选中 m/z 的离子在空间上的强度分布。
- **像素谱图**（底部）：数据集平均谱或选中像素的谱图。
- **区域比较**（底部面板）：比较两个区域组的谱图差异。
- **[Toolbox](./visualization-toolbox)**（右侧）：数据集信息、强度设置、多离子叠加、聚类、ROI 和区域掩膜。
- **[注释面板](./data-annotation)**（左侧）：注释库匹配、评分、结果查看和导出。

![可视化页面布局](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127160509530.jpg_view)

## 离子强度图

显示选中 m/z 的离子在空间上的强度分布热图。

![image-20260911153144224](https://cdn.neonexus.top/docs/20260911153144287.jpg_view)

### 图像交互

| 功能         | 说明                                                         |
| ------------ | ------------------------------------------------------------ |
| **缩放**     | 鼠标滚轮在离子图区域以指针位置为中心缩放；右下 `− / 倍率 / +` 按钮 |
| **平移**     | 放大后按住左键拖动                                           |
| **像素信息** | 悬停显示 1-based 坐标 `(x, y)` 和强度值                      |
| **像素选择** | 点击像素可加载该像素的谱图（Continuous 与 Processed 均支持） |

### 工具栏控件

| 控件                | 说明                                                         |
| ------------------- | ------------------------------------------------------------ |
| **m/z 搜索**        | 仅 Continuous 模式可用，输入目标 m/z，点击 Search 或回车跳转最近峰 |
| **Tolerance ±**     | m/z 容差（默认 0.0001，范围 1e-8 – 1)，控制峰匹配的宽容度    |
| **Colormap**        | 5 种配色：Viridis、Inferno（默认）、Magma、Hot、Gray         |
| **Intensity Scale** | Linear / Log / TIC（连续模式且有预计算 stats/tic 时可用） |
| **Reset**           | 一键恢复所有控件到默认值                                     |
| **JPG / PNG**       | 导出当前图像：默认 JPG（白底），悬停导出按钮可选 PNG（透明背景、无损） |

### 强度调节

- **图像右侧强度条**：上下两个手柄分别为 Max / Min，拖动即时改变对比度；顶部按钮重置为默认范围。多离子叠加时置灰。
- **Toolbox 的 Intensity 区块**：提供 Max / Min 数值输入和 Gamma 调节，详见[可视化工具箱 > 强度设置](./visualization-toolbox#强度设置-intensity)。

## 像素谱图

根据数据模式显示不同内容：

| 模式           | 显示内容                                       | 交互                                                     |
| -------------- | ---------------------------------------------- | -------------------------------------------------------- |
| **Continuous** | 默认整个数据集的平均谱，可切换为选中像素的谱图 | 点击谱图任意位置 → 切换到最接近的 m/z 并刷新离子强度图像 |
| **Processed**  | 选中像素的单点谱                               | 先在 TIC 图上点击像素 → 加载该像素谱                     |

- Centroid 数据显示为**柱状峰**
- Profile 数据显示为**连续曲线**
- 当前选中 m/z 用**竖线高亮**
- 底部显示统计：Peaks、Intensity、Selected/Tolerance 或 Pixel

## 区域比较

**仅 Centroid 数据可用**，用于比较两个区域组（A 组 vs B 组）的谱图差异。区域来源有两类：KMeans 聚类产生的 clusters，以及用户绘制的 ROI（导入的掩膜也作为 ROI 出现在列表中）。页面上至少要有 2 个区域才能开始比较。创建聚类或 ROI 的操作见[可视化工具箱](./visualization-toolbox)。

比较在页面底部的 **Compare regions（区域比较）** 面板中进行：

1. 分别勾选 A 组与 B 组的成员，每组可以包含多个区域；同一个区域不能同时属于两组。组内成员先取并集，再作为一组参与比较。
2. 设置三个参数：
   - **Min detection rate（最低检出率）**：1%–50%，离子在该组中被检出的最低比例。
   - **Intensity threshold（强度阈值）**：0%–20%，按强度分位过滤噪声。
   - **Enrichment ratio（富集倍数）**：1.1×–4×，检出率比达到该倍数即视为富集；它只影响结果分类，调整后无需重新比较。
3. 点击 `Compare` 开始扫描，过程中显示进度、可取消。结果按离子逐行列出，显示两组的检出率、平均强度及各自的比值，并分为 **A only**、**B only**、**A enriched**、**B enriched**、**Shared** 五类；结果可按类别筛选、排序和分页，点击一行会切换到该 m/z 的离子图与谱图。
4. 删除某个区域或重新运行 KMeans 后，基于它的比较结果会失效，需要重新比较。

比较结果可以导出：点击 `Export A/B only + enriched (annotated)`，把 A only / B only / A enriched / B enriched 中已经注释到的离子导出为 CSV（m/z、检出率比、强度比、q 值、总分、候选名），可用 Excel 打开；导出前需要先在[数据注释](./data-annotation)中运行注释。

![区域比较结果](https://official-oss.oss-cn-hongkong.aliyuncs.com/docs/20261127162723202.jpg_view)

### 使用 KMeans 聚类区域

1. 先在[可视化工具箱 > 聚类](./visualization-toolbox#聚类-clustering)中开启并运行 KMeans，选择聚类层数，得到至少两个聚类。

2. 在 **Compare regions（区域比较）** 面板把两个聚类分别勾选到 A 组和 B 组，点击 `Compare` 得到比较结果。

   ![image-20260914161105052](https://cdn.neonexus.top/docs/20260914161105137.jpg_view)

### 使用 ROI 区域

先在[可视化工具箱 > 感兴趣区域 ROI](./visualization-toolbox#感兴趣区域-roi)中绘制并保存至少两个 ROI，再在 **Compare regions（区域比较）** 面板把 ROI1 勾选到 A 组、ROI2 勾选到 B 组，点击 `Compare` 得到比较结果。

![image-20260914161809226](https://cdn.neonexus.top/docs/20260914161809308.jpg_view)