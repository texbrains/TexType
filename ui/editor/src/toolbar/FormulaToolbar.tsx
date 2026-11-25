import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useEditorStore } from "../stores/editorStore";
import type { Command, CommandCategory } from "../types/command";
import { MatrixBuilder } from "./MatrixBuilder";
import { TemplateButton } from "./TemplateButton";
import { toolbarGroups } from "./toolbarGroups";
import styles from "./FormulaToolbar.module.css";

interface Props {
  onInsert: (command: Command) => void;
}

/** A category's colour, mixed into its tab and, for the active category, into the template buttons. */
const tint = (category: CommandCategory) => ({ "--local-tint": `var(--category-${category})` }) as CSSProperties;

/** The side panel: a tab per category and the templates/symbols of the active one. A click inserts. */
export function FormulaToolbar({ onInsert }: Props) {
  const [activeId, setActiveId] = useState<CommandCategory>("common");
  const isEn = useEditorStore((state) => state.language) === "en";
  // the button titles name commands in the user's spelling (exam-zh's \cong for ≌)
  useEditorStore((state) => state.examZhSymbols);
  const tabsRef = useRef<HTMLElement>(null);
  const groups = toolbarGroups();
  const activeGroup = groups.find((group) => group.id === activeId) ?? groups[0];

  useLayoutEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>(`[data-category="${activeId}"]`)
      ?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
  }, [activeId]);

  return (
    <aside className={styles.toolbar} aria-label={isEn ? "Formula toolbar" : "公式工具栏"}>
      <nav ref={tabsRef} className={styles.tabs} aria-label={isEn ? "Formula categories" : "公式分类"}>
          {groups.map((group) => {
            const active = group.id === activeGroup.id;
            return (
              <button
                key={group.id}
                type="button"
                className={styles.tab}
                style={tint(group.id)}
                data-category={group.id}
                aria-pressed={active}
                onClick={() => setActiveId(group.id)}
              >
                {isEn ? group.labelEn : group.labelZh}
              </button>
            );
          })}
      </nav>

      <div
        className={styles.templates}
        style={tint(activeGroup.id)}
        aria-label={isEn ? "Formula templates" : "公式模板"}
      >
        {activeGroup.items.map((item) =>
          item.kind === "matrix" ? (
            <MatrixBuilder key="matrix-builder" isEn={isEn} onInsert={onInsert} />
          ) : (
            <TemplateButton key={item.command.id} command={item.command} isEn={isEn} onInsert={onInsert} />
          ),
        )}
      </div>
    </aside>
  );
}
