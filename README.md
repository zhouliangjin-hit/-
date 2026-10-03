# 马原研习社 · 马克思主义基本原理互动复习

提供完整知识图谱、125 道客观题、7 道主观题、顺序练习、十关闯关、错题本与成绩分析。原生 HTML/CSS/JavaScript，无外部依赖，两种版本均可直接双击使用。

## 直接使用

- **文件夹版**：双击 [Web/index.html](Web/index.html)。分享时复制整个 `Web` 文件夹。
- **单文件版**：双击 [Offline/马原研习社.html](Offline/马原研习社.html)。分享时只需复制该 HTML。

使用较新的 Edge、Chrome 或 Firefox，无需安装 Python、启动 HTTP 服务或联网。学习记录保存在当前浏览器，可在「成绩分析」导出和导入备份；换浏览器、移动文件或升级版本前请先备份。

## 工程结构

```text
mindmap/       原始知识笔记
questions/     课堂小测、期末回忆试题、考研题素材
Web/           可双击打开的文件夹版与维护工具
  assets/      页面程序、样式和图片
  data/        生成的 JSON 与离线数据脚本
  tools/       素材解析、离线打包与验证工具
Offline/       可独立分发的单文件 HTML
```

## 更新与重新生成

维护者修改原始笔记、题库或网页代码后，在工程根目录运行：

```powershell
python Web/tools/build_offline.py
```

命令会同步生成文件夹版数据和单文件成品。详细使用说明见 [Web/README.md](Web/README.md)，架构与数据约定见 [Web/DOCUMENTATION.md](Web/DOCUMENTATION.md)。

仅供公益复习，禁止售卖。
