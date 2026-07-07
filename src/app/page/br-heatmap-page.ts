import { Page } from "./page";
import { Container, Inject, Singleton, utils } from "../../utils";
import { BrHeatmap } from "../../plot/br-heatmap";
import { Content, Sidebar } from "../global-env";
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
        const content = document.getElementById("content");
        if (!content) return;
        content.innerHTML = "";
        const resultsWrapper = document.createElement("div");
        resultsWrapper.id = "ground-rb-wrapper";
        const heatmapWrapper = document.createElement("div");
        heatmapWrapper.id = "legacy-heatmap-wrapper";
        heatmapWrapper.hidden = true;
        content.appendChild(resultsWrapper);
        content.appendChild(heatmapWrapper);
        new GroundRbPanel(Application.metadata).render(resultsWrapper);

        // add view selection
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
        Container.rebind(Content).toConstantValue(d3.select("#legacy-heatmap-wrapper"));
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

        const viewSelect = document.getElementById("view-mode-selection") as HTMLSelectElement;
        const applyView = () => {
            const heatmapMode = viewSelect && viewSelect.value === "heatmap";
            resultsWrapper.hidden = heatmapMode;
            heatmapWrapper.hidden = !heatmapMode;
        };
        applyView();
        utils.setEvent.byIds("view-mode-selection")
            .onchange(() => applyView());
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
