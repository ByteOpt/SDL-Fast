from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
SRC_EXT = ROOT / "extension"
DIST = ROOT / "desktop" / "dist"
OUT = ROOT / "SDL Fast 安装版"
PLUGIN = OUT / "浏览器插件"
EXT = PLUGIN / "extension"
SETUP_NAME = "SDL Fast-setup.exe"

GUIDE = """1、先运行 SDL Fast-setup.exe 完成安装，再启动 SDL Fast 主程序。

2、在浏览器打开扩展管理页，并开启「开发者模式」：

     Chrome：chrome://extensions
     Edge：edge://extensions

3、选择「加载已解压的扩展程序」，指向本目录下的 extension 文件夹。

4、保持 SDL Fast 客户端处于运行状态，即可嗅探网页资源并发送下载。
"""


def copy_extension() -> None:
    if EXT.exists():
        shutil.rmtree(EXT)
    EXT.mkdir(parents=True, exist_ok=True)
    for item in SRC_EXT.iterdir():
        dest = EXT / item.name
        if item.is_dir():
            shutil.copytree(item, dest)
        else:
            shutil.copy2(item, dest)
    (PLUGIN / "使用教程.txt").write_text(GUIDE, encoding="utf-8")


def copy_setup() -> Path:
    candidates = list(DIST.glob("SDL Fast-setup.exe")) + list(DIST.glob("*setup*.exe"))
    if not candidates:
        raise FileNotFoundError("dist 里还没有安装包，请先执行 desktop 目录的 npm run pack")
    src = candidates[0]
    dest = OUT / SETUP_NAME
    shutil.copy2(src, dest)
    return dest


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    copy_extension()
    setup = copy_setup()
    print("plugin", EXT)
    print("setup", setup, setup.stat().st_size)


if __name__ == "__main__":
    main()
