import { createRouter, createWebHistory, type RouteLocationNormalized } from 'vue-router'
import { useAuthStore } from '@/shared/auth/authStore'
import { loadContent } from '@/features/home/config/contentConfig'
import { loadFeatureMessages, type FeatureNs } from '@/i18n'

/**
 * 视图 chunk 与它用到的语言包**并行**加载，两者都就绪后路由才 resolve。
 *
 * 沿用首页 `Promise.all([import(view), loadContent()])` 的既有模式：这样组件渲染时
 * 消息必然已经就位，组件内不必处理「翻译还没到」的中间态，也不会先闪一帧英文。
 * 语言包尚不存在的命名空间（迁移中的 feature）会被静默跳过，见 i18n/index.ts 的 loadNs。
 *
 * 只列**该路由自己会渲染到**的命名空间；core（common/auth）已在启动时加载，不用重复列。
 */
function view<T>(loader: () => Promise<T>, ...namespaces: FeatureNs[]): () => Promise<T> {
  return async () => {
    const [module] = await Promise.all([
      loader(),
      Promise.all(namespaces.map((ns) => loadFeatureMessages(ns))),
    ] as const)
    return module
  }
}

const routes = [
  {
    // 首页内容（团队/时间线/Hero 文案）来自 public/content.json，只有这个路由用得到。
    // 与 HomeView 的 chunk 并行加载，两者都就绪后才 resolve，因此 HomeView 及其子组件
    // 渲染时 getContent() 必然已就位，不必在组件里处理 pending 状态。
    // loadContent() 自带失败兜底，不会让路由 resolve 失败。
    path: '/',
    name: 'Home',
    component: () =>
      Promise.all([
        import('../views/HomeView.vue'),
        loadContent(),
        loadFeatureMessages('home'),
      ]).then(([m]) => m.default),
  },
  {
    path: '/datasets',
    name: 'PublicDatasets',
    // 列表页内嵌上传入口与元数据对话框，故一并带上 upload
    component: view(() => import('../views/PublicDatasets.vue'), 'datasets', 'upload'),
  },
  {
    path: '/mydatasets',
    name: 'MyDatasets',
    component: view(() => import('../views/MyDatasets.vue'), 'datasets', 'upload'),
    meta: { requiresAuth: true },
  },
  {
    // 数据集合：把相关 dataset 组织成策展集合。设计阶段数据为前端 mock。
    path: '/collections',
    name: 'Collections',
    component: view(() => import('../views/CollectionsView.vue'), 'collections'),
    meta: { requiresAuth: true },
  },
  {
    // 新建集合页：从公共数据集中挑选成员、排序并填写元信息（Edit 在 overview 内嵌）
    path: '/collections/new',
    name: 'CreateCollection',
    // 新建集合要从公共数据集里挑成员，会渲染 datasets 的卡片文案
    component: view(() => import('../views/CreateCollectionView.vue'), 'collections', 'datasets'),
    meta: { requiresAuth: true },
  },
  {
    // Collection Overview：public_id 直接进路径（与 Dataset Overview /overview/{public_id}
    // 同方案），刷新/书签/登录回跳都不丢。详情读取走公开接口（认证版详情是
    // owner 限定的，他人集合看不到），写操作用路径里的 public_id 走认证接口。
    path: '/collections/overview/:publicId',
    name: 'CollectionOverview',
    component: view(() => import('../views/CollectionOverviewView.vue'), 'collections', 'datasets'),
    meta: { requiresAuth: true },
  },
  {
    // 集合公开分享页（免登录）：用 public_id 访问，只读展示。
    // 路径不带 public 段——分享链接直接是 /collections/{public_id}。
    // 与 /collections/overview/:publicId 分段数不同不会冲突，
    // 且 public_id 是 16 位 base62，不会与静态段撞名。
    path: '/collections/:publicId',
    name: 'PublicCollection',
    component: view(() => import('../views/PublicCollectionView.vue'), 'collections', 'datasets'),
  },
  {
    // Dataset Overview：public_id 直接进路径（入口在新标签页打开），刷新/收藏/
    // 登录回跳都不丢；来源列表由 query ?source=my|public 控制 Back 去向。私有文件
    // 的元数据仍走登录接口（后端强制登录），URL 只暴露不可枚举的 public_id。
    path: '/overview/:publicId',
    name: 'DatasetOverview',
    component: view(() => import('../views/DatasetOverviewView.vue'), 'datasets'),
  },
  {
    // 数据集分享页。token 仅支持 16 位 public_id；旧 Base64 数字链接的兑换接口
    // 已下线，legacy token 按无效链接处理（判别见 resolveShareToken）。路由本身
    // 不加登录守卫：分享内容需登录浏览，匿名落地后由页面就地引导登录
    // （见 getShareOverviewMetadata）。
    path: '/s/:shareToken',
    name: 'SharedDatasetOverview',
    component: view(() => import('../views/DatasetOverviewView.vue'), 'datasets'),
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue'),
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('../views/RegisterView.vue'),
  },
  {
    path: '/forgotpassword',
    name: 'ForgotPassword',
    component: () => import('../views/ForgotPasswordView.vue'),
  },
  {
    path: '/users',
    name: 'UserManagement',
    component: view(() => import('../views/UserManagementView.vue'), 'users'),
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: '/profile',
    name: 'Profile',
    component: view(() => import('../views/UserProfileView.vue'), 'users'),
    meta: { requiresAuth: true },
  },
  {
    path: '/workspace',
    name: 'Workspace',
    component: view(() => import('../views/workspace/WorkspacePage.vue'), 'workspace'),
    meta: { requiresAuth: true },
  },
  {
    path: '/workspace/new',
    name: 'NewAnalysis',
    // 新建分析要选源数据集，会渲染 datasets 的文案
    component: view(() => import('../views/workspace/NewAnalysis.vue'), 'workspace', 'datasets'),
    meta: { requiresAuth: true },
  },
  {
    // 可视化工作台：分析结果的离子图/光谱/标注可视化页。
    // 信息面板复用 datasets 的字段名与词表（极性等）文案，所以一并加载 datasets。
    path: '/vizworkbench',
    name: 'VizWorkbench',
    component: view(() => import('../views/VizWorkbench.vue'), 'vizworkbench', 'datasets'),
    meta: { requiresAuth: true },
  },
  {
    // 通用数据库浏览页（HMDB 等参考库）：公开参考数据，无需登录。当前数据由各
    // source 的过渡期 fetcher 提供（HMDB 为静态样本 CSV），后端就绪后在
    // features/databases 的 source 里换成走 httpClient 的实现即可。
    path: '/database',
    name: 'Database',
    component: view(() => import('../views/DatabaseView.vue'), 'databases'),
  },
  // 裸 /docs 转发后由 nginx 的 `location = /docs` 301 补斜杠，这里无需特殊处理。
  {
    path: '/docs/:pathMatch(.*)*',
    component: { render: () => null },
    beforeEnter: (to: RouteLocationNormalized) => {
      // Only allow same-origin paths under /docs/ — reject anything with a scheme
      // or that doesn't start with /docs/ (open-redirect guard).
      const fp = to.fullPath
      if (fp.startsWith('/docs/') && !/^[a-z][a-z0-9+\-.]*:/i.test(fp)) {
        window.location.assign(fp)
      }
      return false
    },
  },
]

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes,
})

router.beforeEach(async (to, from, next) => {
  const authRequired = to.matched.some((record) => record.meta.requiresAuth)
  const adminRequired = to.matched.some((record) => record.meta.requiresAdmin)
  // Single source of truth: the auth store (cross-tab synced via storage event).
  const auth = useAuthStore()
  const loggedIn = !!auth.token

  // Redirect already-logged-in users away from login/register/forgot-password
  const fromAuthRequired = from.matched.some((record) => record.meta.requiresAuth)
  if (loggedIn && !fromAuthRequired && ['/login', '/register', '/forgotpassword'].includes(to.path)) {
    // 与 useLoginForm 登录成功后的落地页保持一致：公开数据集列表
    return next('/datasets')
  }

  if (authRequired && !loggedIn) {
    return next({ path: '/login', query: { redirect: to.fullPath } })
  }

  if (authRequired && loggedIn && !auth.user) {
    await auth.fetchUser()
    if (!auth.token) {
      return next({ path: '/login', query: { redirect: to.fullPath } })
    }
  }

  if (adminRequired) {
    if (!auth.user) {
      try { await auth.fetchUser() } catch { /* fetchUser handles 401 */ }
    }
    if (!auth.isAdmin) {
      return next(auth.token ? '/profile' : { path: '/login', query: { redirect: to.fullPath } })
    }
  }

  return next()
})

export default router
