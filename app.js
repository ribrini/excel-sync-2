// ============================================================
// app.js - 教学计划在线查看 网页逻辑
// 纯原生 JavaScript，无框架依赖
// ============================================================

'use strict';

// ===== 全局状态 =====
let allSheets = [];           // data.json 中的所有工作表
let editableData = null;      // editable_data.json 中的编辑数据
let currentTabIndex = 0;      // 当前选中的标签
let dirtyCells = {};           // 未保存的修改 { sheetName: { row: { col: value } } }
let isSaving = false;
let pollTimer = null;
let lastDataHash = '';        // 用于检测 data.json 是否变化
let lastEditableHash = '';    // 用于检测 editable_data.json 是否变化
let editorName = localStorage.getItem('editor_name') || '';

// ===== 初始化 =====
document.addEventListener('DOMContentLoaded', init);

async function init() {
    // 检查编辑者名称
    if (!editorName) {
        showNameModal();
    } else {
        document.getElementById('editor-name').textContent = editorName;
    }

    // 绑定事件
    document.getElementById('btn-save').addEventListener('click', saveEditableData);
    document.getElementById('editor-name').addEventListener('click', showNameModal);
    document.getElementById('name-confirm').addEventListener('click', confirmName);
    document.getElementById('name-cancel').addEventListener('click', hideNameModal);
    document.getElementById('name-input').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') confirmName();
    });

    // 加载数据
    await loadData();
    renderTabs();
    renderCurrentSheet();
    startPolling();
}

// ===== 数据源 URL =====
function getBaseUrl() {
    if (CONFIG.dataSource) return CONFIG.dataSource.replace(/\/$/, '');
    return `https://${CONFIG.githubUser}.github.io/${CONFIG.githubRepo}`;
}

function getApiUrl(path) {
    return `https://api.github.com/repos/${CONFIG.githubUser}/${CONFIG.githubRepo}/contents/${path}`;
}

function getRawUrl(path) {
    return `https://raw.githubusercontent.com/${CONFIG.githubUser}/${CONFIG.githubRepo}/${CONFIG.githubBranch}/${path}`;
}

// ===== 加载数据 =====
async function loadData() {
    const baseUrl = getBaseUrl();
    const ts = Date.now(); // 防缓存

    // 1. 加载 data.json（VBA 导出的全部数据）
    try {
        const resp = await fetch(`${baseUrl}/data.json?t=${ts}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        allSheets = json.sheets || [];
        lastDataHash = await hashJson(json);
        document.getElementById('last-update').textContent = 'Excel更新: ' + (json.exportTime || '—');
        updateStatus('synced', '数据已同步');
    } catch (err) {
        console.error('加载 data.json 失败:', err);
        allSheets = [];
        updateStatus('error', '加载失败');
        showToast('数据加载失败，请检查网络或配置', 'error');
    }

    // 2. 加载 editable_data.json（网页端编辑数据，可能不存在）
    try {
        const resp = await fetch(`${baseUrl}/editable_data.json?t=${ts}`);
        if (resp.ok) {
            editableData = await resp.json();
            lastEditableHash = await hashJson(editableData);
        } else {
            editableData = null;
        }
    } catch (err) {
        editableData = null;
    }
}

// ===== 渲染标签栏 =====
function renderTabs() {
    const container = document.getElementById('tabs');
    container.innerHTML = '';

    if (allSheets.length === 0) {
        container.innerHTML = '<span style="padding:10px 20px;color:#999;">暂无数据</span>';
        return;
    }

    allSheets.forEach((sheet, index) => {
        const tab = document.createElement('button');
        tab.className = 'tab' + (index === currentTabIndex ? ' active' : '');
        tab.textContent = sheet.name;

        if (sheet.editable) {
            const dot = document.createElement('span');
            dot.className = 'editable-dot';
            dot.title = '可编辑';
            tab.appendChild(dot);
        }

        tab.addEventListener('click', () => {
            currentTabIndex = index;
            renderTabs();
            renderCurrentSheet();
        });

        container.appendChild(tab);
    });
}

// ===== 渲染当前工作表 =====
function renderCurrentSheet() {
    const content = document.getElementById('content');
    const footer = document.getElementById('footer');

    if (allSheets.length === 0) {
        content.innerHTML = '<div class="empty-state"><p>暂无数据。请先运行 sync_excel.bat 导出数据。</p></div>';
        footer.style.display = 'none';
        return;
    }

    const sheet = allSheets[currentTabIndex];

    if (sheet.editable) {
        renderEditableTable(sheet);
        footer.style.display = 'flex';
    } else {
        renderReadOnlyTable(sheet);
        footer.style.display = 'none';
    }
}

// ===== 渲染只读表格 =====
function renderReadOnlyTable(sheet) {
    const content = document.getElementById('content');
    const headers = sheet.headers || [];
    const data = sheet.data || [];

    let html = '<div class="sheet-container">';
    html += '<div class="sheet-title">' + escapeHtml(sheet.name) +
            '<span class="badge badge-readonly">只读</span></div>';
    html += '<div class="table-wrap"><table><thead><tr>';

    headers.forEach(h => {
        html += '<th>' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';

    if (data.length === 0) {
        html += '<tr><td colspan="' + headers.length + '" style="color:#999;text-align:center;padding:20px;">暂无数据</td></tr>';
    } else {
        data.forEach(row => {
            html += '<tr>';
            // 确保 row 是数组
            const rowArr = Array.isArray(row) ? row : [row];
            for (let c = 0; c < headers.length; c++) {
                const val = rowArr[c] !== undefined ? rowArr[c] : '';
                html += '<td' + (val === '' ? ' class="empty"' : '') + '>' + escapeHtml(val) + '</td>';
            }
            html += '</tr>';
        });
    }

    html += '</tbody></table></div></div>';
    content.innerHTML = html;
}

// ===== 渲染可编辑表格 =====
function renderEditableTable(sheet) {
    const content = document.getElementById('content');
    const headers = sheet.headers || [];

    // 合并 data.json 和 editable_data.json 的数据
    // 优先使用 editable_data.json 中的数据（教师编辑覆盖）
    let data = sheet.data || [];
    if (editableData && editableData.sheets && editableData.sheets[sheet.name]) {
        data = editableData.sheets[sheet.name].data || data;
    }

    let html = '<div class="sheet-container">';
    html += '<div class="sheet-title">' + escapeHtml(sheet.name) +
            '<span class="badge badge-editable">可编辑</span></div>';
    html += '<div class="table-wrap"><table><thead><tr>';

    headers.forEach(h => {
        html += '<th>' + escapeHtml(h) + '</th>';
    });
    html += '</tr></thead><tbody>';

    if (data.length === 0) {
        // 没有数据时显示一些空行供编辑
        for (let i = 0; i < 5; i++) {
            html += '<tr>';
            for (let c = 0; c < headers.length; c++) {
                html += '<td><input type="text" data-sheet="' + escapeAttr(sheet.name) +
                        '" data-row="' + i + '" data-col="' + c + '"></td>';
            }
            html += '</tr>';
        }
    } else {
        data.forEach((row, rowIndex) => {
            const rowArr = Array.isArray(row) ? row : [row];
            html += '<tr>';
            for (let c = 0; c < headers.length; c++) {
                const val = rowArr[c] !== undefined ? rowArr[c] : '';
                html += '<td><input type="text" value="' + escapeAttr(val) +
                        '" data-sheet="' + escapeAttr(sheet.name) +
                        '" data-row="' + rowIndex +
                        '" data-col="' + c + '"></td>';
            }
            html += '</tr>';
        });

        // 额外添加 3 个空行供新增数据
        for (let i = data.length; i < data.length + 3; i++) {
            html += '<tr>';
            for (let c = 0; c < headers.length; c++) {
                html += '<td><input type="text" data-sheet="' + escapeAttr(sheet.name) +
                        '" data-row="' + i + '" data-col="' + c + '"></td>';
            }
            html += '</tr>';
        }
    }

    html += '</tbody></table></div></div>';
    content.innerHTML = html;

    // 绑定 input 事件 - 标记 dirty
    content.querySelectorAll('input[data-sheet]').forEach(input => {
        input.addEventListener('input', onCellEdit);
    });

    // 应用 dirty 状态（如果有未保存的修改）
    applyDirtyState();
}

// ===== 单元格编辑事件 =====
function onCellEdit(e) {
    const input = e.target;
    const sheetName = input.dataset.sheet;
    const row = parseInt(input.dataset.row);
    const col = parseInt(input.dataset.col);

    if (!dirtyCells[sheetName]) dirtyCells[sheetName] = {};
    if (!dirtyCells[sheetName][row]) dirtyCells[sheetName][row] = {};

    dirtyCells[sheetName][row][col] = input.value;
    input.classList.add('dirty');
    updateSaveButton();
}

// ===== 应用 dirty 状态 =====
function applyDirtyState() {
    // 在重新渲染后恢复 dirty 标记
    document.querySelectorAll('input[data-sheet]').forEach(input => {
        const sheetName = input.dataset.sheet;
        const row = parseInt(input.dataset.row);
        const col = parseInt(input.dataset.col);

        if (dirtyCells[sheetName] && dirtyCells[sheetName][row] && dirtyCells[sheetName][row][col] !== undefined) {
            input.value = dirtyCells[sheetName][row][col];
            input.classList.add('dirty');
        }
    });
    updateSaveButton();
}

// ===== 更新保存按钮状态 =====
function updateSaveButton() {
    const btn = document.getElementById('btn-save');
    const hasDirty = Object.keys(dirtyCells).length > 0 &&
                     Object.values(dirtyCells).some(sheet =>
                         Object.values(sheet).some(row => Object.keys(row).length > 0)
                     );
    btn.disabled = !hasDirty || isSaving;
}

// ===== 收集所有可编辑数据 =====
function collectEditableData() {
    const sheets = {};

    allSheets.forEach(sheet => {
        if (!sheet.editable) return;

        const inputs = document.querySelectorAll(`input[data-sheet="${cssEscape(sheet.name)}"]`);
        if (inputs.length === 0) return;

        // 找到最大行号和列号
        let maxRow = -1;
        let maxCol = -1;
        const cellMap = {};

        inputs.forEach(input => {
            const row = parseInt(input.dataset.row);
            const col = parseInt(input.dataset.col);
            const val = input.value.trim();

            if (val !== '') {
                if (!cellMap[row]) cellMap[row] = {};
                cellMap[row][col] = val;
                if (row > maxRow) maxRow = row;
                if (col > maxCol) maxCol = col;
            }
        });

        // 构建二维数组
        const data = [];
        for (let r = 0; r <= maxRow; r++) {
            if (!cellMap[r]) continue;
            const rowArr = [];
            let hasData = false;
            for (let c = 0; c <= maxCol; c++) {
                const val = cellMap[r][c] || '';
                rowArr.push(val);
                if (val !== '') hasData = true;
            }
            if (hasData) data.push(rowArr);
        }

        sheets[sheet.name] = {
            headers: sheet.headers || [],
            data: data
        };
    });

    return {
        lastEditTime: new Date().toLocaleString('zh-CN'),
        lastEditor: editorName || '未知',
        sheets: sheets
    };
}

// ===== 保存编辑数据 =====
async function saveEditableData() {
    if (isSaving) return;

    const hasUnsaved = Object.keys(dirtyCells).length > 0 &&
                       Object.values(dirtyCells).some(sheet =>
                           Object.values(sheet).some(row => Object.keys(row).length > 0)
                       );

    if (!hasUnsaved) {
        showToast('没有需要保存的修改', 'info');
        return;
    }

    isSaving = true;
    updateSaveButton();
    const statusEl = document.getElementById('save-status');
    statusEl.textContent = '正在保存...';
    statusEl.className = '';

    try {
        const data = collectEditableData();
        const jsonStr = JSON.stringify(data, null, 2);

        if (CONFIG.workerUrl) {
            // 使用 Cloudflare Worker
            await saveViaWorker(jsonStr);
        } else {
            // 直接使用 GitHub API
            await saveViaGithub(jsonStr);
        }

        // 保存成功
        dirtyCells = {};
        editableData = JSON.parse(jsonStr);
        lastEditableHash = await hashJson(editableData);

        statusEl.textContent = '保存成功 ✓';
        statusEl.className = 'save-success';
        showToast('保存成功！其他教师将看到最新数据', 'success');

        // 重新渲染当前表（清除 dirty 标记）
        renderCurrentSheet();
    } catch (err) {
        console.error('保存失败:', err);
        statusEl.textContent = '保存失败: ' + err.message;
        statusEl.className = 'save-error';
        showToast('保存失败: ' + err.message, 'error');
    } finally {
        isSaving = false;
        updateSaveButton();
        setTimeout(() => {
            statusEl.textContent = '';
        }, 5000);
    }
}

// ===== 通过 GitHub API 保存 =====
async function saveViaGithub(jsonStr) {
    const path = 'editable_data.json';
    const url = getApiUrl(path);

    // Base64 编码（支持 UTF-8）
    const b64content = btoa(unescape(encodeURIComponent(jsonStr)));

    // 获取当前文件的 SHA（如果文件已存在）
    let sha = null;
    try {
        const resp = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${CONFIG.githubToken}`,
                'Accept': 'application/vnd.github+json'
            }
        });
        if (resp.ok) {
            const data = await resp.json();
            sha = data.sha;
        }
    } catch (e) {
        // 文件不存在，无需 SHA
    }

    // PUT 请求更新文件
    const body = {
        message: `网页编辑更新 - ${editorName} - ${new Date().toLocaleString('zh-CN')}`,
        content: b64content,
        branch: CONFIG.githubBranch || 'main'
    };
    if (sha) body.sha = sha;

    const resp = await fetch(url, {
        method: 'PUT',
        headers: {
            'Authorization': `token ${CONFIG.githubToken}`,
            'Accept': 'application/vnd.github+json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.message || `HTTP ${resp.status}`);
    }

    // 等待 GitHub Pages 更新（通常需要几秒到几十秒）
    showToast('GitHub 正在更新页面，请稍候...', 'info');
}

// ===== 通过 Cloudflare Worker 保存 =====
async function saveViaWorker(jsonStr) {
    const resp = await fetch(CONFIG.workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: jsonStr
    });

    if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Worker 错误: ${err}`);
    }
}

// ===== 轮询更新 =====
function startPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(pollUpdates, CONFIG.pollInterval || 10000);
}

async function pollUpdates() {
    const baseUrl = getBaseUrl();
    const ts = Date.now();

    try {
        // 检查 data.json 是否更新
        const dataResp = await fetch(`${baseUrl}/data.json?t=${ts}`);
        if (dataResp.ok) {
            const json = await dataResp.json();
            const newHash = await hashJson(json);

            if (newHash !== lastDataHash) {
                // data.json 已更新（Excel 端推送了新数据）
                lastDataHash = newHash;
                allSheets = json.sheets || [];
                document.getElementById('last-update').textContent =
                    'Excel更新: ' + (json.exportTime || '—');

                // 重新渲染（保留未保存的修改）
                renderTabs();
                renderCurrentSheet();

                showToast('Excel 数据已更新', 'info');
            }
        }

        // 检查 editable_data.json 是否更新（其他教师的编辑）
        const editResp = await fetch(`${baseUrl}/editable_data.json?t=${ts}`);
        if (editResp.ok) {
            const json = await editResp.json();
            const newHash = await hashJson(json);

            if (newHash !== lastEditableHash) {
                lastEditableHash = newHash;
                editableData = json;

                // 仅在没有未保存修改时才重新渲染
                const hasDirty = Object.keys(dirtyCells).length > 0 &&
                                 Object.values(dirtyCells).some(sheet =>
                                     Object.values(sheet).some(row => Object.keys(row).length > 0)
                                 );

                if (!hasDirty) {
                    renderCurrentSheet();
                    showToast(`其他教师已更新数据（${json.lastEditor || ''}）`, 'info');
                } else {
                    showToast(`其他教师有更新，请先保存或刷新当前修改`, 'info');
                }
            }
        }
    } catch (err) {
        // 轮询失败静默处理
        console.debug('Poll error:', err);
    }
}

// ===== 工具函数 =====

function updateStatus(type, text) {
    const el = document.getElementById('sync-status');
    el.className = 'status-badge status-' + type;
    el.textContent = text;
}

function showToast(msg, type) {
    type = type || 'info';
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = msg;
    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transition = 'opacity 0.3s';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

async function hashJson(obj) {
    const str = JSON.stringify(obj);
    if (window.crypto && window.crypto.subtle) {
        const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    // Fallback: simple hash
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return String(hash);
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function escapeAttr(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function cssEscape(s) {
    return s.replace(/["\\]/g, '\\$&');
}

// ===== 编辑者名称弹窗 =====
function showNameModal() {
    document.getElementById('name-modal').style.display = 'flex';
    const input = document.getElementById('name-input');
    input.value = editorName;
    setTimeout(() => input.focus(), 100);
}

function hideNameModal() {
    document.getElementById('name-modal').style.display = 'none';
}

function confirmName() {
    const name = document.getElementById('name-input').value.trim();
    if (!name) {
        showToast('请输入你的名字', 'error');
        return;
    }
    editorName = name;
    localStorage.setItem('editor_name', name);
    document.getElementById('editor-name').textContent = name;
    hideNameModal();
}
