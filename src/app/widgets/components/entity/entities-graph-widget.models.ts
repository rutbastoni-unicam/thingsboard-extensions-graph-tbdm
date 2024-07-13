///
/// Copyright © 2024 Rut Bastoni rut.bastoni@gmail.com
///

import { Datasource, EntityType, AliasEntityType } from '@shared/public-api';

export interface EntitiesGraphWidgetSettings {
  graph?: {
    backgroundColor?: string;
    assetNodeColor?: string;
    deviceNodeColor?: string;
    collapsedNodeColor?: string;
    nodeSize?: number;
    linkDistance?: number;
    linkWidth?: number;
    linkArrowLength?: number;
    linkColor?: string;
    linkManagedDevicesColor?: string;
    rootNodeSpecialSettings?: boolean;
    rootNodeSize?: number;
    rootNodeColor?: string;
    fixPositionAfterDrag?: boolean;
    deviceIcon?: string;
  };
  // Inspired by system EntitiesHierarchyWidgetComponent, but not implemented
  // nodeRelationQueryFunction: string;
  // nodeHasChildrenFunction: string;
  // nodeOpenedFunction: string;
  // nodeDisabledFunction: string;
  // nodeIconFunction: string;
  // nodeTextFunction: string;
  // nodesSortFunction: string;
}

export interface GraphNodeDatasource extends Datasource {
  nodeId: string;
}

export interface GraphNode {
  id: string;
  label: string;
  name: string;
  entityType: EntityType | AliasEntityType;
  childrenNodesLoaded: boolean;
  level: number;
  datasource: GraphNodeDatasource;
  collapsed?: boolean;
  childLinks: GraphLink[];
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relationType: string;
  color?: string;
}

export const defaultGraphWidgetSettings: any = {
  graph: {
    backgroundColor: '#a7c1dE', //Default light blue like in Thingsboard theme - rgb(167, 193, 222)
    assetNodeColor: '#ffffaa', //Default yellow ForceGraph3D theme - rgb(255, 255, 170)
    deviceNodeColor: '#ffffff', //Default white to serve as background for device icon - rgb(255, 255, 255)
    collapsedNodeColor: '#008000', //Default green like in Thingsboard theme for success popups - rgb(255, 255, 255)
    nodeSize: 100,
    linkDistance: 100,
    linkWidth: 5,
    linkArrowLength: 15,
    linkColor: '#f0f0f0',
    linkManagedDevicesColor: '#f9a19b',
    rootNodeSpecialSettings: true,
    rootNodeSize: 500,
    rootNodeColor: '#f9a19b', //Default light blue like in Thingsboard theme - rgb(249, 161, 155)
    fixPositionAfterDrag: true,
    deviceIcon: 'data:image/png;base64,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'
  }
};
