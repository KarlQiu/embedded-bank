# 嵌入式校招八股题库网页

这个目录是可部署到 GitHub Pages 的静态网页。

## 本地预览

在仓库根目录运行：

```powershell
python .\tools\build_web.py
python -m http.server 8000 -d web
```

浏览器打开 `http://127.0.0.1:8000/`，默认访问密码是 `emb2026`。

## GitHub Pages

仓库已包含 `.github/workflows/deploy-pages.yml`。推送到 GitHub 后，在仓库 Settings -> Pages 中选择 GitHub Actions 作为发布来源，工作流会发布 `web/` 目录。
