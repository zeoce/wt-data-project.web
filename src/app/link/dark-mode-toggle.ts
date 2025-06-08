import { Link } from "./link";
import { Inject, Singleton } from "../../utils";
import { Localization } from "../config";
import * as d3 from "d3";

@Singleton(DarkModeToggle)
export class DarkModeToggle extends Link {
    @Inject(Localization.Navbar.DarkMode) readonly name: string;
    readonly id = "dark-mode-checkbox";
    readonly url = "#";
    private checkbox: d3.Selection<HTMLInputElement, unknown, HTMLElement, any>;

    private applyMode(enabled: boolean) {
        d3.select("body").classed("dark-mode", enabled);
    }

    init(): void {
        const li = this.navbar.append<HTMLLIElement>("li");
        const label = li.append<HTMLLabelElement>("label")
            .text(this.name);
        this.checkbox = label.append<HTMLInputElement>("input")
            .attr("type", "checkbox")
            .attr("id", this.id);

        const saved = localStorage.getItem(this.id) === "true";
        this.checkbox.property("checked", saved);
        this.applyMode(saved);

        this.checkbox.on("change", () => {
            const checked = this.checkbox.property("checked") as boolean;
            localStorage.setItem(this.id, checked.toString());
            this.applyMode(checked);
        });
    }
}
