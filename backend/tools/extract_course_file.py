"""Dependency-free course document text extraction helper.

Input and output are single JSON documents on stdin/stdout so the Node service can
apply its own validation, chunking, persistence and retrieval rules.
"""

import base64
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
from xml.etree import ElementTree


MAX_ARCHIVE_FILES = 3000
MAX_ARCHIVE_UNCOMPRESSED = 80 * 1024 * 1024


def fail(message):
    raise ValueError(message)


def safe_zip(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    members = archive.infolist()
    if len(members) > MAX_ARCHIVE_FILES:
        fail("压缩文档内部文件数量异常")
    if sum(member.file_size for member in members) > MAX_ARCHIVE_UNCOMPRESSED:
        fail("压缩文档解压后体积过大")
    if any(member.flag_bits & 0x1 for member in members):
        fail("暂不支持加密文档")
    return archive


def xml_text(data):
    root = ElementTree.fromstring(data)
    paragraphs = []
    current = []
    for element in root.iter():
        name = element.tag.rsplit("}", 1)[-1]
        if name == "t" and element.text:
            current.append(element.text)
        elif name in ("tab",):
            current.append("\t")
        elif name in ("br", "cr"):
            current.append("\n")
        elif name in ("p", "tr") and current:
            value = "".join(current).strip()
            if value:
                paragraphs.append(value)
            current = []
    if current:
        value = "".join(current).strip()
        if value:
            paragraphs.append(value)
    return "\n".join(paragraphs)


def docx_sections(data):
    with safe_zip(data) as archive:
        names = set(archive.namelist())
        if "word/document.xml" not in names:
            fail("DOCX 缺少正文结构")
        sections = [{
            "locator": "正文",
            "title": "正文",
            "text": xml_text(archive.read("word/document.xml")),
        }]
        for name, title in (
            ("word/footnotes.xml", "脚注"),
            ("word/endnotes.xml", "尾注"),
            ("word/comments.xml", "批注"),
        ):
            if name in names:
                text = xml_text(archive.read(name))
                if text:
                    sections.append({"locator": title, "title": title, "text": text})
        return sections


def natural_number(value):
    match = re.search(r"(\d+)", value)
    return int(match.group(1)) if match else 0


def pptx_sections(data):
    with safe_zip(data) as archive:
        slide_names = sorted(
            (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=natural_number,
        )
        if not slide_names:
            fail("PPTX 中没有可读取的幻灯片")
        sections = []
        for index, name in enumerate(slide_names, 1):
            text = xml_text(archive.read(name))
            if text:
                first_line = text.splitlines()[0][:120]
                sections.append({
                    "locator": f"第 {index} 页",
                    "title": first_line or f"第 {index} 页",
                    "text": text,
                })
        return sections


def pdf_sections(data):
    executable = shutil.which("pdftotext")
    if not executable:
        fail("服务器未安装 PDF 文本提取组件 pdftotext")
    with tempfile.TemporaryDirectory(prefix="learnmate-source-") as folder:
        source_path = os.path.join(folder, "source.pdf")
        output_path = os.path.join(folder, "source.txt")
        with open(source_path, "wb") as output:
            output.write(data)
        completed = subprocess.run(
            [executable, "-layout", "-enc", "UTF-8", source_path, output_path],
            capture_output=True,
            timeout=45,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.decode("utf-8", errors="replace").strip()
            fail("PDF 解析失败" + (f"：{detail[:300]}" if detail else ""))
        with open(output_path, "r", encoding="utf-8", errors="replace") as source:
            text = source.read()
    pages = text.split("\f")
    return [
        {"locator": f"第 {index} 页", "title": f"第 {index} 页", "text": page.strip()}
        for index, page in enumerate(pages, 1)
        if page.strip()
    ]


def main():
    payload = json.load(sys.stdin)
    extension = str(payload.get("extension", "")).lower()
    try:
        data = base64.b64decode(payload.get("contentBase64", ""), validate=True)
    except Exception as error:
        fail(f"文件编码无效：{error}")
    if extension == ".docx":
        sections = docx_sections(data)
    elif extension == ".pptx":
        sections = pptx_sections(data)
    elif extension == ".pdf":
        sections = pdf_sections(data)
    else:
        fail("不支持的文档类型")
    print(json.dumps({"sections": sections}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": str(error)}, ensure_ascii=False))
        sys.exit(1)
