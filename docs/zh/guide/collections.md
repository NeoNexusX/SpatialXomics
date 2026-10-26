# 数据集合

本文介绍SpatialXomics中数据集合的浏览与查找、创建流程、成员管理以及公开分享方式。

作者：陈柯江

问题反馈：如果在使用 SpatialXomics 或阅读文档时发现问题，可通过 [GitHub Issue](https://github.com/NeoNexusX/MassVision/issues) 提交反馈，或联系邮箱：**jydong@xmu.edu.cn**。



## 操作说明

### 1. 进入数据集合页面

点击导航栏`Datahub`—`Collections`进入数据集合列表页面。此外，公开数据集与我的数据集页的筛选栏中提供了进入数据集合的链接；数据集合列表页的页头也提供了跳往公开数据集、我的数据集的按钮。

![8cdf16d5380095f9c84d8ed3bfb2e74c](https://cdn.neonexus.top/docs/20261008153852015.jpg_view)

### 2. 浏览与查找数据集合

列表页默认展示全平台的数据集合，勾选`My collections only`后仅显示自己创建的集合。页面提供以下查找方式：

- **搜索**：顶部搜索框支持按集合名称模糊搜索，搜索范围覆盖全部分页。
- **筛选**：点击`Add filter`后，可按`Collection name`、`Title`、`Journal name`、`Owner username`等条件筛选；`Member Type`与`Collection Type`为词表多选；`Organism`等词表字段的含义是"集合内包含该值即命中"，同一字段多个取值之间为"或"的关系。
- **排序**：列表固定按最后更新时间倒序排列。

列表采用服务端分页，底部可切换页码与每页数量。

![13b1e2f9747350467b5909b9b7226cc7](https://cdn.neonexus.top/docs/20261008160300900.jpg_view)

### 3. 集合卡片

每张集合卡片展示：

- 封面与`Organism`标签；
- `Creator`、`Created`、`Updated`等基本信息；
- DOI、`Title`、`Journal`、`Access`等学术元数据，信息较多时折叠进`More`；
- 徽章：所有集合卡片均带`Public Collection`徽章——平台所有集合均为公开。如需只看自己创建的集合，可勾选列表页的`My collections only`（见第 2 节）。

点击`View Collection`会在新标签页打开集合详情页；卡片上的`Share`可复制该集合的公开链接（见第 7 节）；集合所有者与管理员可对集合进行删除（见第 8 节）。

![08d68cd0b3daf066d5a8050d5910ba95](https://cdn.neonexus.top/docs/20261008160355076.jpg_view)

### 4. 创建集合

在列表页点击`Create Collection`进入创建流程，共四步：

**第 1 步：选择数据集。** 从已完成处理的公开 imzML 数据集中勾选成员，支持搜索定位；已勾选的数据集在翻页后保持选择状态。

![image-20261008160500321](https://cdn.neonexus.top/docs/20261008160500400.jpg_view)

**第 2 步：调整顺序。** 拖动成员卡片或使用`Move up`/`Move down`按钮调整展示顺序，`Remove from collection`可取消选择。

![9a30c6537827d8fbe01e8d5e3d3bee19](https://cdn.neonexus.top/docs/20261008160602518.jpg_view)

**第 3 步：集合信息。** 填写集合`Name`（必填，最多 80 个字符）与`Description`（选填，最多 300 个字符）。

![image-20261008160820237](https://cdn.neonexus.top/docs/20261008160820287.jpg_view)

**第 4 步：元数据。** `Member Type`、`Collection Type`以及`Sample`/`Acquisition`组中的`Organism`、`Organism Part`、`Sample Stabilization`、`Polarity`、`Ionisation Source`、`Analyzer`为必填；`Sample`与`Acquisition`相关字段会根据所选数据集自动填写，手动修改某个字段后，该字段不再随数据集自动更新，需要时可点击`Reset to detected`还原。`Citation`信息（`DOI`、`Title`、`Journal`、`Access`、`Published`、`Citation`、`Abstract`）均为选填，其中 DOI 需符合 `10.1000/xyz123`、`doi:10.1000/xyz123` 或 `https://doi.org/10.1000/xyz123` 格式。

![A](https://cdn.neonexus.top/docs/20261008160932254.jpg_view)

![image-20261008161009263](https://cdn.neonexus.top/docs/20261008161009351.jpg_view)

::: warning 注意
数据集合创建后即为公开，平台不提供私有集合。创建过程中离开页面会弹出确认提示，未保存的选择与信息将丢失。
:::

完成后点击`Create Collection`提交，成功后自动跳转至新集合的详情页。

### 5. 查看与编辑集合详情

集合详情页展示名称、简介、完整学术元数据与成员列表。

集合所有者与管理员可点击`Edit`进入编辑状态，原地修改名称、简介与元数据，点击`Save Changes`后提交（仅提交发生变化的字段）；`Name`必填且不超过 80 个字符，`Description`不超过 300 个字符，超出时页面会提示。

![image-20261008161053722](https://cdn.neonexus.top/docs/20261008161053801.jpg_view)

![image-20261008161200282](https://cdn.neonexus.top/docs/20261008161200374.jpg_view)

### 6. 管理集合成员

集合所有者与管理员可在详情页中继续管理成员：

- **添加成员**：点击`Add Members`，从公开数据集中选择并批量追加到列表末尾，已在集合中的数据集会标记`Already in collection`且不可重复选择。

  <img src="https://cdn.neonexus.top/docs/20261008161234181.jpg_view" alt="image-20261008161234123" style="zoom:50%;" />

- **移除成员**：勾选成员后点击`Remove Selected`，完成后提示实际移除数量；已被他人在别处移除的成员会自动跳过并单独提示。

  ![e76d5da425ab50194ce54ed4ecee5868](https://cdn.neonexus.top/docs/20261008161347873.jpg_view)

- **调整顺序**：在编辑状态下，可拖动成员或使用`Move up`/`Move down`调整顺序；若他人在别处修改过顺序，页面会提示并自动刷新为最新顺序。

- **成员上限**：每个集合最多包含 300 个数据集。

- **下载**：每个成员可单独下载原始文件。



### 7. 分享数据集合

点击详情页的`Share`即可复制集合的公开链接，链接为 `/collections/` 开头、由集合 public id 构成的地址。收到链接的任何人**无需登录**即可查看该集合的只读页面（成员列表与元数据）；集合不存在或已不再公开时，页面会给出统一提示。

由于数据集合创建即公开，无需也无法单独设置集合的可见性。

### 8. 删除数据集合

集合所有者与管理员可在详情页点击`Delete`，在`Delete collection?`确认弹窗中确认后删除该集合。删除仅移除集合本身，其中的数据集不受任何影响。

![4f125424a255308135ef0e308677e516](https://cdn.neonexus.top/docs/20261008172114280.jpg_view)