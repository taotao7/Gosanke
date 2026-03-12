# Gosanke 架构说明

## 项目定位

这是一个基于 `WXT + React` 的浏览器扩展，用来把同一条输入同时分发到：

- `Claude`
- `ChatGPT`
- `Gemini`

这三个站点通常不允许被 `iframe` 直接嵌入，所以当前方案不是单页内嵌，而是：

- `3 个站点独立 popup 窗口`
- `1 个中控 workspace 窗口`
- `1 个扩展 popup 启动器`

## 目录职责

### `entrypoints/background.ts`

后台服务是整个工作台的编排中心，负责：

- 接收 popup / controller / content script 的消息
- 创建或复用 Claude / ChatGPT / Gemini / controller 四类窗口
- 根据当前显示器工作区动态计算默认布局
- 记住用户调整过的窗口位置和大小
- 拖拽换位后只更新布局，不主动刷新站点页面
- 将文本和图片附件分发到三个目标站点
- 汇总站点状态并广播给 popup / controller

### `entrypoints/controller/`

这是中控工作台窗口，负责：

- 展示三个站点当前状态
- 展示槽位布局：`左上 / 右上 / 底部`
- 拖拽站点卡片修改站点摆放顺序
- 输入提示词
- 选择图片附件
- 将文本和图片一起发送给后台
- 触发“重新排版”

### `entrypoints/popup/`

这是浏览器工具栏点击后打开的小 popup，职责很简单：

- 展示当前三个站点的状态概览
- 作为工作台启动器
- 调用后台恢复或打开 workspace

### `entrypoints/content.ts`

内容脚本注入到三类站点页面中，负责：

- 检测当前页面属于哪个站点
- 识别输入框、发送按钮、上传控件、登录入口
- 持续上报登录状态 / 输入框状态 / 回复状态
- 接收后台下发的文本和图片
- 将文本写入目标站点输入区
- 将图片注入站点的 `input[type="file"]`
- 在按钮可发送后点击发送

### `utils/workspace.ts`

共享模型与配置中心，负责：

- 站点枚举、窗口枚举、状态类型定义
- 站点 URL / selector / 上传入口定义
- 工作台布局算法
- 默认窗口尺寸计算
- 存储结构和 rect 校验

## 运行架构

### 1. 启动工作台

用户从扩展 popup 点击“启动工作台”后：

1. popup 向 background 发送 `workspace/open`
2. background 优先恢复已保存的窗口 rect
3. 如果没有历史布局，则按当前显示器 `workArea` 计算默认布局
4. background 创建或复用四个 popup 窗口

关键点：

- `启动工作台` 默认是恢复模式
- 不应每次启动都重排用户已经改过的布局

### 2. 拖拽换位

用户在 controller 中拖拽站点卡片后：

1. controller 更新 `order`
2. 向 background 发送 `workspace/rearrange`
3. background 仅根据当前工作区重算三个站点槽位
4. 通过 `windows.update` 调整窗口位置

关键点：

- 这里的目标是换位，不是刷新页面
- 已打开的站点窗口应尽量复用，不重建、不丢上下文

### 3. 重新排版

用户点击“重新排版”后：

1. controller 向 background 发送 `workspace/arrange`
2. background 重新读取当前显示器 `workArea`
3. 使用模板布局重新计算窗口大小和位置
4. 覆盖当前保存的 rect

关键点：

- 这是显式重排行为
- 只有这个动作才应主动把布局打回模板

### 4. 状态检测

每个站点内容脚本会持续检测：

- 是否存在聊天输入框
- 是否存在可点击发送按钮
- 是否存在登录入口
- 是否已经出现模型输出内容

后台汇总后广播给：

- popup 启动器
- controller 工作台

当前状态语义：

- `ready`: 已检测到输入框，可认为已登录
- `login_required`: 页面存在登录入口但没有输入框
- `loading`: 页面仍在加载或 UI 还没准备好

### 5. 文本和图片发送

当前发送链路支持：

- 纯文本
- 纯图片
- 文本 + 图片

发送流程：

1. controller 读取 textarea 和图片文件
2. 将图片转成可序列化的 `bytes`
3. 发送给 background
4. background 再分别转发给三个站点 content script
5. content script 先处理图片上传，再写入文本，再尝试发送

图片上传策略是启发式的：

- 优先找现成的 `input[type="file"]`
- 找不到时尝试点击“Attach / Upload / Image”之类的入口
- 再回查文件输入框并注入文件

## 当前存储设计

后台通过 `browser.storage.local` 保存：

- `gosanke.workspace.order`
  - 三个站点的摆放顺序
- `gosanke.workspace.layout`
  - 当前工作区整体边界
- `gosanke.workspace.windowRects`
  - 四个窗口各自的位置和大小

设计目的：

- 下次启动恢复用户改过的布局
- 拖拽或缩放窗口后自动记住
- 多显示器下仍能保留用户自己的工作区习惯

## 当前消息通道

### popup / controller -> background

- `workspace/get-snapshot`
- `workspace/open`
- `workspace/rearrange`
- `workspace/arrange`
- `workspace/send-prompt`
- `workspace/controller-ready`

### content -> background

- `site/status`

### background -> content

- `site/submit-prompt`

### background -> popup / controller

- `workspace/snapshot`

## 当前产品行为约束

### 1. 不用 iframe

这不是 UI 偏好问题，而是目标站点安全策略决定的。当前架构必须继续基于多窗口方案。

### 2. 站点 DOM 很不稳定

输入框、发送按钮、上传按钮都依赖启发式 selector。后续如果某个站点改版，优先检查：

- `utils/workspace.ts` 中该站点的 selector
- `entrypoints/content.ts` 中上传和发送策略

### 3. 页面上下文应尽量保留

用户已经打开并操作中的站点窗口，不应因为普通的打开工作台或换位动作被刷新。

### 4. “重新排版”和“恢复布局”必须区分

这两个动作语义不同：

- `恢复布局`: 尊重用户手工调整结果
- `重新排版`: 按模板重新计算布局

## 后续改动建议

如果要继续扩展功能，建议优先沿这几个方向推进：

- 给每个站点补更稳的上传 selector
- 给图片上传增加完成态检测，而不是只靠等待时间
- 为 workspace 增加“锁定布局”或“恢复默认布局”
- 给发送结果增加分站点失败原因展示
- 给保存布局增加显示器变更后的越界修正逻辑
