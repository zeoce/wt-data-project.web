import { Page } from "./page";
import { Container, Inject, Singleton, utils } from "../../utils";
import { BrHeatmap } from "../../plot/br-heatmap";
import { Sidebar, Content } from "../global-env";
import { BrRangeSelect, ClassSelect, DateSelect, MeasurementSelect, ModeSelect, Select, ViewModeSelect } from "../sidebar/select";
import * as d3 from "d3";
import { BRRange, Clazz, Measurement, Mode } from "../options";
import { Localization } from "../config";
import { Checkbox, ColorblindCheckbox } from "../sidebar/checkbox";
import { Application } from "../application";
import { GroundRbPanel } from "../ground-rb-panel";


@Singleton(BRHeatMapPage)
export class BRHeatMapPage extends Page {
    plot: BrHeatmap;
    readonly id = "br-heatmap";
    @Inject(Localization.Navbar.BrHeatmap) readonly name: string;
    @Inject(Sidebar) sidebar: d3.Selection<HTMLDivElement, unknown, HTMLElement, any>;

    update(): void {
        // remove old plot
        this.removeOld();

        // Render Ground RB panel elements in a specific container, and heatmap elements in another wrapper
        const contentDiv = document.getElementById("content");

        // Clear everything first in case
        contentDiv.innerHTML = "";

        // Wrapper for Ground RB Panel
        const groundRbWrapper = document.createElement("div");
        groundRbWrapper.id = "ground-rb-wrapper";
        contentDiv.appendChild(groundRbWrapper);
        new GroundRbPanel(Application.metadata).render(groundRbWrapper);

        // Wrapper for Heatmap (will be initialized below)
        const heatmapWrapper = document.createElement("div");
        heatmapWrapper.id = "heatmap-wrapper";
        heatmapWrapper.style.display = "none"; // Hide by default
        contentDiv.appendChild(heatmapWrapper);

        // Now use D3 to select the new heatmap wrapper for plot initialization
        Container.rebind(Content).toConstantValue(d3.select("#heatmap-wrapper"));

        // Add visibility selection toggle in sidebar
        Container.get<Select>(ViewModeSelect).init();

        // add date selection
        Container.get<Select>(DateSelect).init();
        // add class selection
        Container.get<Select>(ClassSelect).init();
        // add mode selection for measurement
        Container.get<Select>(ModeSelect).init();
        // add measurement selection
        Container.get<Select>(MeasurementSelect).init();
        // br range selection
        Container.get<Select>(BrRangeSelect).init();
        // colorblind mode checkbox
        Container.get<Checkbox>(ColorblindCheckbox).init();
        // init main content plot
        // rebind the container to BrHeatmap constructor to new a object
        Container.rebind(BrHeatmap).toSelf();
        this.plot = Container.get(BrHeatmap);
        // rebind the plot object as constant value for other subplots
        Container.rebind(BrHeatmap).toConstantValue(this.plot);
        this.plot.init();

        // change any selection will refresh the BrHeatmap.
        utils.setEvent.byClass("plot-selection")
            .onchange(() => this.plot.update(false));
        // override some selection forcing re-download time-series data
        utils.setEvent.byIds("mode-selection", "br-range-selection")
            .onchange(() => this.plot.update(true));
        // update the colors when colorblind mode is changed
        utils.setEvent.byIds("colorblind-checkbox")
            .onchange(async () => {
                localStorage.setItem("colorblind-checkbox", d3.select("#colorblind-checkbox").property("checked").toString())
                await this.plot.update(false)
            });

        // Set up toggle logic for Results vs Heatmap
        utils.setEvent.byIds("view-mode-selection")
            .onchange(() => {
                const selectedMode = utils.getSelectedValue("view-mode-selection");
                if (selectedMode === "results") {
                    document.getElementById("ground-rb-wrapper").style.display = "block";
                    document.getElementById("heatmap-wrapper").style.display = "none";
                } else {
                    document.getElementById("ground-rb-wrapper").style.display = "none";
                    document.getElementById("heatmap-wrapper").style.display = "block";
                }
                localStorage.setItem("view-mode-selection", selectedMode);
            });

        // Load saved state if exists
        const savedViewMode = localStorage.getItem("view-mode-selection");
        if (savedViewMode) {
            const selectElement = document.getElementById("view-mode-selection") as HTMLSelectElement;
            if (selectElement) {
                selectElement.value = savedViewMode;
                selectElement.dispatchEvent(new Event("change"));
            }
        }
    }

    get date(): string {
        return utils.getSelectedValue("date-selection");
    }

    get clazz(): Clazz {
        return utils.getSelectedValue("class-selection");
    }

    get mode(): Mode {
        return utils.getSelectedValue("mode-selection");
    }

    get measurement(): Measurement {
        return utils.getSelectedValue("measurement-selection");
    }

    get brRange(): BRRange {
        return utils.getSelectedValue("br-range-selection");
    }
}
