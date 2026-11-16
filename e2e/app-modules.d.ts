// page.evaluate 里的 import('/src/...') 在浏览器中由 Vite dev server 解析；
// Node 侧类型检查找不到这些绝对路径，统一声明为 any（运行时不受影响）。
declare module '/src/*'
