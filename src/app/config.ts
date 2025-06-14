import { Container, ObjChainMap } from "../utils";
import { Nation } from "../data/wiki-data";
import { Measurement } from "./options";
import * as d3 from "d3";

/* ───────────────────────────────────────────────
   Base URL for all data files (CSV / JSON)
   ─────────────────────────────────────────────── */
export const DATA_BASE =
  "https://raw.githubusercontent.com/ControlNet/wt-data-project.data/master";

/* -------------- existing interfaces -------------- */

export interface ConfigJson {
  readonly BrHeatmapPage: {
    readonly BrHeatmap: MainPlotConfigJson;
    readonly ColorBar: PlotConfigJson;
    readonly BrLineChart: PlotConfigJson;
    readonly Legend: PlotConfigJson;
    readonly Tooltip: TooltipConfigJson;
    readonly LineChartTooltip: TooltipConfigJson;
  };

  readonly StackedAreaPage: {
    readonly StackedLineChart: MainPlotConfigJson;
    readonly Legend: PlotConfigJson;
  };
}

export class Margin {
  readonly top!: number;
  readonly right!: number;
  readonly bottom!: number;
  readonly left!: number;
}

interface PlotConfigJson {
  readonly svgHeight: number;
  readonly svgWidth: number;
  readonly margin: Margin;
}

interface MainPlotConfigJson extends PlotConfigJson {
  readonly mainSvgId: string;
}

interface TooltipConfigJson {
  readonly parentSvgId: string;
  readonly opacity: number;
  readonly nRow: number;
  readonly rectWidth: number;
  readonly rectXBias: number;
  readonly rectYBias: number;
  readonly textXBias: number;
  readonly textYBias: number;
  readonly leftShiftXThreshold: number;
  readonly downShiftYThreshold: number;
  readonly leftShiftOffset: number;
  readonly downShiftOffset: number;
}

/* -------------- internal helper classes -------------- */

abstract class AbstractConfig {
  protected readonly class = "Config";
  protected readonly plot: string;
  protected readonly page: string;

  constructor(page: string, name: string) {
    this.page = page;
    this.plot = name;
  }
}

class PlotConfig extends AbstractConfig {
  get svgHeight() {
    return `${this.class}.${this.page}.${this.plot}.svgHeight`;
  }
  get svgWidth() {
    return `${this.class}.${this.page}.${this.plot}.svgWidth`;
  }
  get margin() {
    return `${this.class}.${this.page}.${this.plot}.margin`;
  }
}

class MainPlotConfig extends PlotConfig {
  get mainSvgId() {
    return `${this.class}.${this.page}.${this.plot}.mainSvgId`;
  }
}

class TooltipConfig extends AbstractConfig {
  get parentSvgId() {
    return `${this.class}.${this.page}.${this.plot}.parentSvgId`;
  }
  get opacity() {
    return `${this.class}.${this.page}.${this.plot}.opacity`;
  }
  get nRow() {
    return `${this.class}.${this.page}.${this.plot}.nRow`;
  }
  get rectWidth() {
    return `${this.class}.${this.page}.${this.plot}.rectWidth`;
  }
  get rectXBias() {
    return `${this.class}.${this.page}.${this.plot}.rectXBias`;
  }
  get rectYBias() {
    return `${this.class}.${this.page}.${this.plot}.rectYBias`;
  }
  get textXBias() {
    return `${this.class}.${this.page}.${this.plot}.textXBias`;
  }
  get textYBias() {
    return `${this.class}.${this.page}.${this.plot}.textYBias`;
  }
  get leftShiftXThreshold() {
    return `${this.class}.${this.page}.${this.plot}.leftShiftXThreshold`;
  }
  get downShiftYThreshold() {
    return `${this.class}.${this.page}.${this.plot}.downShiftYThreshold`;
  }
  get leftShiftOffset() {
    return `${this.class}.${this.page}.${this.plot}.leftShiftOffset`;
  }
  get downShiftOffset() {
    return `${this.class}.${this.page}.${this.plot}.downShiftOffset`;
  }
}

/* -------------- main Config class -------------- */

export class Config {
  static async load(): Promise<void> {
    const json: ConfigJson = await (await fetch("config/params.json")).json();

    new ObjChainMap()
      .addLayer(() => json)
      .addLayer((page: keyof Config) => json[page])
      .addLayer((page: keyof Config, plot: string) => json[page][plot])
      .addLayer(
        (page: keyof Config, plot: string, attr: string) =>
          json[page][plot][attr]
      )
      .forEach((layers, value) => {
        const [page, plot, attr] = layers as [keyof Config, string, string];
        const key = (Config as any)[page][plot][attr];
        Container.bind(key).toConstantValue(value);
      });
  }

  static BrHeatmapPage = class {
    static BrHeatmap = new MainPlotConfig("BrHeatmapPage", "BrHeatmap");
    static ColorBar = new PlotConfig("BrHeatmapPage", "ColorBar");
    static BrLineChart = new PlotConfig("BrHeatmapPage", "BrLineChart");
    static Legend = new PlotConfig("BrHeatmapPage", "Legend");
    static Tooltip = new TooltipConfig("BrHeatmapPage", "Tooltip");
    static LineChartTooltip = new TooltipConfig(
      "BrHeatmapPage",
      "LineChartTooltip"
    );
  };

  static StackedAreaPage = class {
    static StackedLineChart = new MainPlotConfig(
      "StackedAreaPage",
      "StackedLineChart"
    );
    static Legend = new PlotConfig("StackedAreaPage", "Legend");
  };
}

/* -------------- Localization (unchanged) -------------- */

export interface LocalizationJson {/* unchanged – keep existing code */}

abstract class AbstractLocalization {/* unchanged */}

class NavbarLocalization extends AbstractLocalization {/* unchanged */}
class SelectionLocalization extends AbstractLocalization {/* unchanged */}
class CheckboxLocalization extends AbstractLocalization {/* unchanged */}

export type NationTranslator = (n: Nation) => string;
export type MeasurementTranslator = (m: Measurement) => string;

export class Localization {
  static async load() {
    /* original load() body unchanged */
  }

  static Navbar = new NavbarLocalization();
  static Sidebar = class {/* unchanged */};

  static BrHeatmapPage = {
    Tooltip: new class {
      get nation() { return "Localization.BrHeatmapPage.Tooltip.nation"; }
      get br() { return "Localization.BrHeatmapPage.Tooltip.br"; }
    }(),
    BrLineChart: new class {
      get date() { return "Localization.BrHeatmapPage.BrLineChart.date"; }
    }()
  };

  static StackedAreaPage = {
    StackedLineChart: new class {
      get date() { return "Localization.StackedAreaPage.StackedLineChart.date"; }
      get battles() { return "Localization.StackedAreaPage.StackedLineChart.battles"; }
    }()
  };

  static Nation = "Localization.Nation";
  static Measurement = "Localization.Measurement";
}
