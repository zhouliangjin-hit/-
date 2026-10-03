# 马原研习社 · 文件夹离线版

思维导图、顺序刷题、闯关模式、错题本、成绩分析和主观题精讲组成的纯静态复习网站。

## 打开与分享

直接双击本目录的 **index.html**，用较新的 Edge、Chrome 或 Firefox 打开即可，无需联网、Python 或 HTTP 服务。分享时请复制整个 `Web` 文件夹，保持 `assets` 和 `data` 的相对位置。

工程根目录的 **Offline/马原研习社.html** 是同一网站的单文件版本，只需分享这个 HTML。两种版本也可以经普通静态 HTTP 服务访问。

## 思维导图

依据 `mindmap/chapter-01.md` 的完整标题、嵌套列表和正文生成知识树，保留原文与源行号，不截断说明。支持分支聚焦、全文搜索定位、图谱与目录阅读、折叠展开、缩放平移及关联练习。量变质变、否定之否定的过程关系使用独立示意图。

关联练习正确率表示该组题目的作答结果，不等同于对单个知识点的掌握程度。

## 学习备份

记录保存在当前浏览器中；文件路径变化、浏览器变化、清理浏览器数据都可能影响记录。请到「成绩分析」导出 JSON 学习备份，换电脑、换版本或升级后可在同页导入。旧版本导出的裸 JSON 存档也支持导入。存储不可用时页面会提示，仍可在本次打开期间练习。

## 更新资料与生成成品（维护者）

在工程根目录运行：

```powershell
python Web/tools/build_offline.py
```

该命令从 `mindmap` 和 `questions` 读取素材，生成四份 `Web/data/*.json`、文件夹版的数据脚本 `Web/data/offline-data.js`，并将当前页面完整打包到 `Offline/马原研习社.html`。仅维护者生成成品时需要 Python，最终用户不需要。

修改页面代码后，如果无需重新解析资料，可运行：

```powershell
python Web/tools/build_offline.py --skip-sources
```

导图资料保持 Markdown 标题和列表缩进；不要手改生成的 JSON、数据脚本或单文件 HTML。开发约定见 [DOCUMENTATION.md](DOCUMENTATION.md)。

生成后可运行核心验证（维护者环境需要 Python 与 Node.js）：

```powershell
python -X utf8 -m unittest discover -s Web/tools -p "test_*.py"
node Web/tools/test_runtime.js
```

## 数据与使用约定

客观题 125 道（判断 1、单选 83、多选 41）、主观题 7 道、五个题库。试卷与解析来自回忆版与公益整理，仅供复习，禁止售卖。
