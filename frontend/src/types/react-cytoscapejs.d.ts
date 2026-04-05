declare module "react-cytoscapejs" {
  import type { Core, StylesheetJson } from "cytoscape";
  import type { ComponentType, CSSProperties } from "react";

  export interface CytoscapeComponentProps {
    elements?: unknown;
    stylesheet?: StylesheetJson;
    layout?: Record<string, string | number | boolean>;
    style?: CSSProperties;
    cy?: (cy: Core) => void;
    [key: string]: unknown;
  }

  const CytoscapeComponent: ComponentType<CytoscapeComponentProps>;
  export default CytoscapeComponent;
}
