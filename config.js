// ============================================================
// config_template.js - 网页配置模板（部署时被替换 dataSource）
// ============================================================

const CONFIG = {
    // GitHub 仓库信息（部署时由 setup_new_project.py 替换）
    githubUser: 'ribrini',
    githubRepo: 'excel-sync',
    githubBranch: 'main',

    // GitHub Token（混淆存储，非明文）
    githubToken: String.fromCharCode(103,105,116,104,117,98,95,112,97,116,95,49,49,67,71,89,51,79,83,65,48,119,52,86,106,106,79,82,105,66,55,71,78,95,72,99,80,77,90,115,54,67,120,105,67,112,122,54,109,118,79,97,119,70,120,77,48,90,114,117,97,116,107,75,65,86,65,56,71,104,72,49,72,121,106,98,109,54,81,88,69,88,86,90,82,99,84,118,112,98,88,82,113),

    // Cloudflare Worker URL（可选，更安全的写入方式）
    workerUrl: '',

    // 轮询间隔（毫秒）
    pollInterval: 10000,

    // 数据源 URL（部署时由 setup_new_project.py 替换为对应仓库的 raw URL）
    // 留空时使用上面的 githubUser/githubRepo/githubBranch 自动拼接
    dataSource: 'https://raw.githubusercontent.com/ribrini/excel-sync-2/main/data.json',
};
