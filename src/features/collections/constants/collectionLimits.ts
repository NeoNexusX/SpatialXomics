/**
 * 集合的写入上限（与后端写入校验一致）。
 *
 * 成员上限 300：创建接口的 file_public_ids 总数 ≤ 300（数组顺序即初始成员顺序），
 * 添加成员同样受此限制（超出时后端返回 409 collection member limit exceeded）。
 * 前端在创建页与「添加成员」弹窗里都按剩余名额拦截，避免把必然失败的请求发出去。
 */
export const COLLECTION_MEMBER_LIMIT = 300
