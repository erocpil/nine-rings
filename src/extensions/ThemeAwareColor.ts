import Color from "@tiptap/extension-color";
import { editorForegroundStyle } from "../lib/editor-color";

/** Theme adaptation is presentation only; clipboard and storage retain original ink. */
export const ThemeAwareColor = Color.extend({
  addGlobalAttributes() {
    return [{
      types: this.options.types,
      attributes: {
        color: {
          default: null,
          parseHTML: element => element.getAttribute("data-text-color") ?? element.style.color?.replace(/['"]+/g, ""),
          renderHTML: attributes => attributes.color ? {
            "data-text-color": attributes.color,
            style: `color: ${editorForegroundStyle(attributes.color)}`,
          } : {},
        },
      },
    }];
  },
});
