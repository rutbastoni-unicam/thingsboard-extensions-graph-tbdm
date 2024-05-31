import { Datasource } from '@shared/public-api';

export interface EntitiesGraphWidgetSettings {
  nodeRelationQueryFunction: string;
  nodeHasChildrenFunction: string;
  nodeOpenedFunction: string;
  nodeDisabledFunction: string;
  nodeIconFunction: string;
  nodeTextFunction: string;
  nodesSortFunction: string;
}

export interface GraphNodeDatasource extends Datasource {
  nodeId: string;
}

export interface GraphNode {
  id: string;
  label: string;
  name: string;
  entityType: string;
  childrenNodesLoaded: boolean;
  datasource: GraphNodeDatasource;
}

export interface GraphLink {
  source: string;
  target: string;
  relationType: string;
}
