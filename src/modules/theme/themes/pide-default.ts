import type { Theme } from "../types";

export const pideDefault: Theme = {
  id: "pide-default",
  name: "Pide Default",
  description: "The default Pide look — clean glass over neutral surfaces.",
  editorTheme: { dark: "atomone", light: "atomone" },
  variants: {
    light: {},
    dark: {},
  },
};
