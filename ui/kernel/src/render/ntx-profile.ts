// The "Times New Roman" profile (newtxtext + newtxmath) of the layout engine:
// its data and fonts, loaded only when that letter font is chosen.
import tfm from "../../data/profiles/ntx/tfm.json";
import meanings from "../../data/profiles/ntx/latex-meanings.json";
import templates from "../../data/profiles/ntx/latex-templates.json";
import onearg from "../../data/profiles/ntx/latex-onearg.json";
import textFonts from "../../data/profiles/ntx/text-fonts.json";
import fonts from "../../data/profiles/ntx/fonts.json";
import profile from "../../data/profiles/ntx/profile.json";
import "../../data/profiles/ntx/fonts/fonts.css";

export default { tfm, meanings, templates, onearg, textFonts, fonts, profile };
