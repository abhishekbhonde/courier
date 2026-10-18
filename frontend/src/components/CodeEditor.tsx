import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { EditorView } from "@codemirror/view";
import CodeMirror, { type Extension } from "@uiw/react-codemirror";
import { useMemo } from "react";
import type { BodyLanguage } from "../lib/format";
import { useTheme } from "../store/theme";

export function CodeEditor({
  value,
  onChange,
  language = "text",
  readOnly = false,
  wrap = false,
  placeholder,
  className,
}: {
  value: string;
  onChange?: (v: string) => void;
  language?: BodyLanguage;
  readOnly?: boolean;
  wrap?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const theme = useTheme((s) => s.theme);
  const extensions = useMemo(() => {
    const ext: Extension[] = [];
    if (language === "json") ext.push(json());
    if (language === "html") ext.push(html());
    if (language === "xml") ext.push(xml());
    if (wrap) ext.push(EditorView.lineWrapping);
    return ext;
  }, [language, wrap]);

  return (
    <CodeMirror
      value={value}
      onChange={onChange}
      extensions={extensions}
      theme={theme}
      readOnly={readOnly}
      editable={!readOnly}
      placeholder={placeholder}
      height="100%"
      className={className ?? "h-full"}
      basicSetup={{
        foldGutter: true,
        highlightActiveLine: !readOnly,
        highlightActiveLineGutter: !readOnly,
        autocompletion: false,
      }}
    />
  );
}
