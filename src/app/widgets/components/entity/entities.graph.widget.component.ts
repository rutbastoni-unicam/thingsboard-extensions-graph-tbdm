import {AfterViewInit, Component, ElementRef, Input, OnInit, Renderer2, ViewEncapsulation} from '@angular/core';

import {
  defaultGraphWidgetSettings,
  EntitiesGraphWidgetSettings,
  GraphLink,
  GraphNode,
  GraphNodeDatasource
} from './entities-graph-widget.models';
import {
  AliasFilterType,
  Authority,
  CONTAINS_TYPE,
  Datasource,
  DatasourceType,
  DeviceInfo,
  EntityRelationsQuery,
  EntitySearchDirection,
  EntityType,
  MANAGES_TYPE,
  PageComponent,
  PageData,
  PageLink,
  RelationTypeGroup,
  WidgetConfig,
  widgetType
} from '@shared/public-api';
import {RelationsQueryFilter} from '@shared/models/alias.models';
import {
  getCurrentAuthUser,
  isDefined,
  IWidgetSubscription,
  UtilsService,
  WidgetSubscription,
  WidgetSubscriptionOptions
} from '@core/public-api';
import {WidgetComponent} from '@home/components/widget/widget.component';
import {WidgetContext} from '../../models/widget-component.models';
import {Store} from '@ngrx/store';
import {AppState} from '@core/core.state';

import ForceGraph3D, {ForceGraph3DInstance} from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import {GUI} from 'lil-gui';
import {concatMap, map, Observable} from "rxjs";

@Component({
  selector: 'tb-entities-graph-widget',
  templateUrl: 'entities.graph.widget.component.html',
  styleUrls: ['entities.graph.widget.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class EntitiesGraphWidgetComponent extends PageComponent implements OnInit, AfterViewInit   {

  @Input()
  ctx: WidgetContext;

  @Input()
  debugAssets: Array<string>;

  public toastTargetId = 'entities-graph-' + this.utils.guid();

  public dataLoading = true;
  public dataLoaded = false;

  protected graphData: {nodes: Array<GraphNode>; links: Array<GraphLink>} = {
    nodes: [],
    links: []
  };

  protected nodesMap = {};
  private nodesToProcess: Array<GraphNode> = [];
  private rootNodes: Array<GraphNode> = [];

  private settings: EntitiesGraphWidgetSettings;
  private widgetConfig: WidgetConfig;
  private subscription: IWidgetSubscription;
  private datasources: Array<GraphNodeDatasource>;

  //Visual graph configs
  private graphBackgroundColor: string;
  private graphAssetNodeColor: string;
  private graphDeviceNodeColor: string;
  private graphCollapsedNodeColor: string;
  private graphNodeSize: number;
  private graphDistanceSize: number;
  private graphLinkWidth: number;
  private graphLinkArrowLength: number;
  private graphLinkColor: string;
  private graphLinkManagedDevicesColor: string;
  private rootNodeSpecialSettings: boolean;
  private rootNodeSize: number;
  private graphRootNodeColor: string;
  private fixPositionAfterDrag: boolean;
  private deviceIcon;

  private graphDomElement: HTMLElement =  null;
  private openedRelationsTooltip: GUI = null;

  private graph!: ForceGraph3DInstance;

  constructor(protected store: Store<AppState>,
              private elementRef: ElementRef,
              private widgetComponent: WidgetComponent,
              private renderer: Renderer2,
              private utils: UtilsService) {
    super(store);
  }

  ngOnInit() {
    console.log(this.ctx);
    this.ctx.$scope.entitiesGraphWidget = this;
    this.settings = this.ctx.settings;
    this.widgetConfig = this.ctx.widgetConfig;
    this.subscription = this.ctx.defaultSubscription;

    //TODO verify if GraphNodeDatasource type is necessary
    this.datasources = this.subscription.datasources as Array<GraphNodeDatasource>;

    //TODO code this
    // this.initializeConfig();

    this.ctx.updateWidgetParams();

    // Load settings from widget config or from defaults
    const graphSettings = this.settings?.graph;
    const defaultGraphSettings = defaultGraphWidgetSettings.graph;
    this.graphBackgroundColor = graphSettings?.backgroundColor || defaultGraphSettings.backgroundColor;
    this.graphAssetNodeColor = graphSettings?.assetNodeColor || defaultGraphSettings.assetNodeColor;
    this.graphDeviceNodeColor = graphSettings?.deviceNodeColor || defaultGraphSettings.deviceNodeColor;
    this.graphCollapsedNodeColor = graphSettings?.collapsedNodeColor || defaultGraphSettings.collapsedNodeColor;
    this.graphNodeSize = graphSettings?.nodeSize || defaultGraphSettings.nodeSize;
    this.graphDistanceSize = graphSettings?.linkDistance || defaultGraphSettings.linkDistance;
    this.graphLinkWidth = graphSettings?.linkWidth || defaultGraphSettings.linkWidth;
    this.graphLinkArrowLength = graphSettings?.linkArrowLength || defaultGraphSettings.linkArrowLength;
    this.graphLinkColor = graphSettings?.linkColor || defaultGraphSettings.linkColor;
    this.graphLinkManagedDevicesColor = graphSettings?.linkManagedDevicesColor || defaultGraphSettings.linkManagedDevicesColor;
    this.rootNodeSpecialSettings =
      isDefined(graphSettings?.rootNodeSpecialSettings) ?  graphSettings?.rootNodeSpecialSettings : defaultGraphSettings.rootNodeSpecialSettings;
    this.rootNodeSize = graphSettings?.rootNodeSize || defaultGraphSettings.rootNodeSize;
    this.graphRootNodeColor = graphSettings?.rootNodeColor || defaultGraphSettings.rootNodeColor;
    this.fixPositionAfterDrag =
      isDefined(graphSettings?.fixPositionAfterDrag) ?  graphSettings?.fixPositionAfterDrag : defaultGraphSettings.fixPositionAfterDrag;
    this.deviceIcon = graphSettings?.deviceIcon || defaultGraphSettings.deviceIcon;


  }

  ngAfterViewInit(): void {
    const nativeElement = this.elementRef.nativeElement;
    this.graphDomElement = nativeElement.querySelector('.tb-entities-graph-container');
    this.renderer.setStyle(this.graphDomElement, 'background-color', this.graphBackgroundColor);

    if(this.ctx.dashboardService.currentUrl === '/widget-editor' && Array.isArray(this.debugAssets)
      && this.debugAssets.length > 0){
      //Re-create custom datasources and subscribe to them
      this.datasources = null;

      const datasource: Datasource = {
        type: 'entity',
        dataKeys: [],
        entityFilter: {
          type: AliasFilterType.entityList,
          entityType: EntityType.ASSET,
          entityList: this.debugAssets
        }
      };

      const subscriptionOptions: WidgetSubscriptionOptions = {
        type: widgetType.latest,
        datasources: [datasource],
        callbacks: //Sets callbacks for subscription
          {
            // If root-level datasource changes, reload the full graph
            onDataUpdated: () => {
              this.loadNodes();
            }
          }
      };

      this.ctx.subscriptionApi.createSubscription(subscriptionOptions, true).subscribe({
        next: (subscription) => {
          this.ctx.subscriptionApi.removeSubscription(this.subscription.id);

          this.ctx.defaultSubscription = subscription;
          this.ctx.data = subscription.data;
          this.ctx.datasources = subscription.datasources;

          this.subscription = subscription;

          //TODO verify if GraphNodeDatasource type is necessary
          this.datasources = this.subscription.datasources as Array<GraphNodeDatasource>;
        }}
      );

    } else {
      this.loadNodes();
    }
  }

  private initializeConfig() {
  }

  isEmpty(): boolean {
    return this.graphData.nodes.length < 1;
  }

  public loadNodes() {
    this.dataLoading = true;
    this.ctx.detectChanges();

    this.nodesMap = {};
    this.nodesToProcess = [];
    this.rootNodes = [];
    this.graphData = {nodes: [], links: []};

    this.datasources.forEach((childDatasource, index) => {
      this.datasourceToNode(childDatasource, 0);
    });

    this.processNodes();
  }

  public onResize() {
    this.closeRelationsTooltipIfOpened();

    if(!this.dataLoaded) {
      return;
    }

    this.graph
      .height(this.graphDomElement.clientHeight)
      .width(this.graphDomElement.clientWidth);
  }

  private datasourceToNode(childDatasource: GraphNodeDatasource, level: number) {
    const entityId = childDatasource.entityId;

    //In case of more datasources pointing to same entity, simply overwrite label and name with last values found
    if(entityId in this.nodesMap) {
      this.nodesMap[entityId].label = childDatasource.entityLabel;
      this.nodesMap[entityId].name = childDatasource.entityName;
      this.nodesMap[entityId].entityType = childDatasource.entityType;
    } else {
      const nodeToProcess: GraphNode = {
        id: entityId,
        label: childDatasource.entityLabel,
        name: childDatasource.entityName,
        entityType: childDatasource.entityType,
        childrenNodesLoaded: false,
        level: level,
        datasource: childDatasource,
        childLinks: []
      };
      this.nodesToProcess.push(nodeToProcess);
      this.nodesMap[entityId] = nodeToProcess;
      if(level == 0) {
        this.rootNodes.push(nodeToProcess);
      }
    }
  }

  private processSingleNode(nodeToProcess: GraphNode) {
    nodeToProcess.childrenNodesLoaded = false;

    //Relation type - if asset, 'Contains', if device, 'Manages'
    const relationType: string = nodeToProcess.entityType === EntityType.ASSET ? 'Contains' : 'Manages';

    //Entity types - if asset, both assets and device, if device, only devices
    //TODO could handle also other kinds of entities
    const entityTypes: Array<EntityType> =
      nodeToProcess.entityType === EntityType.ASSET ? [EntityType.ASSET, EntityType.DEVICE] : [EntityType.DEVICE];

    //Relations query preparation
    const relationQuery: EntityRelationsQuery = {
      parameters: {
        rootId: nodeToProcess.id,
        rootType: nodeToProcess.entityType as EntityType,
        direction: EntitySearchDirection.FROM,
        relationTypeGroup: RelationTypeGroup.COMMON,
        maxLevel: 1
      },
      filters: [
        {
          relationType: relationType,
          entityTypes: entityTypes
        }
      ]
    };

    const entityFilter = {
      rootEntity: {
        id: relationQuery.parameters.rootId,
        entityType: relationQuery.parameters.rootType
      },
      direction: relationQuery.parameters.direction,
      filters: relationQuery.filters,
      maxLevel: relationQuery.parameters.maxLevel,
      fetchLastLevelOnly: relationQuery.parameters.fetchLastLevelOnly,
      type: AliasFilterType.relationsQuery
    } as RelationsQueryFilter;

    const childrenDatasource = {
      dataKeys: nodeToProcess.datasource.dataKeys,
      type: DatasourceType.entity,
      filterId: nodeToProcess.datasource.filterId,
      entityFilter
    };

    return new Promise<void>((resolve, reject) => {
      const subscriptionOptions: WidgetSubscriptionOptions = {
        type: widgetType.latest,
        datasources: [childrenDatasource],
        callbacks: {
          onSubscriptionMessage: (subscription, message) => {
            this.ctx.showToast(message.severity, message.message, undefined,
              'top', 'left', this.toastTargetId);
          },
          onInitialPageDataChanged: (subscription) => {
            this.ctx.subscriptionApi.removeSubscription(subscription.id);
            //TODO seems for graph is not convenient to redraw full graphics
            // this.nodeEditCallbacks.refreshNode(parentNode.id);
          },
          onDataUpdated: subscription => {
            if(nodeToProcess.childrenNodesLoaded) {
              //TODO handle if you want to show latest values of devices in graph, see method 'updateNodeData' of component
              // EntitiesHierarchyWidgetComponent in official repository
            } else {
              const datasourcesPageData = subscription.datasourcePages[0];
              datasourcesPageData.data.forEach((childDatasource: GraphNodeDatasource, index) => {
                this.datasourceToNode(childDatasource, (nodeToProcess.level + 1));

                //Save relation in graph data
                const childRelationType =
                  (subscription as WidgetSubscription).configuredDatasources[0].entityFilter.filters[0].relationType;
                const graphLink: GraphLink = {
                  source: nodeToProcess.id,
                  target: childDatasource.entityId,
                  relationType: childRelationType,
                  color: childRelationType === CONTAINS_TYPE ? this.graphLinkColor : this.graphLinkManagedDevicesColor
                };
                this.graphData.links.push(graphLink);
              });
              nodeToProcess.childrenNodesLoaded = true;

              resolve();
            }

          }
        }
      };

      this.ctx.subscriptionApi.createSubscription(subscriptionOptions, true);
    });
  }

  private async processNodes() {
    while (this.nodesToProcess.length > 0) {
      const nodeToProcess = this.nodesToProcess.shift();
      await this.processSingleNode(nodeToProcess);
      this.graphData.nodes.push(nodeToProcess);
    }

    //Clean all possible calculated before childlinks
    this.graphData.nodes.forEach(graphNode => {
      graphNode.childLinks = [];
    });

    this.graphData.links.forEach(link => {
      const sourceId = typeof (link.source) === 'string' ? link.source : (link.source as GraphNode).id;
      this.nodesMap[sourceId].childLinks.push(link);
    });

    this.dataLoading = false;
    this.dataLoaded = true;
    this.widgetComponent.displayNoData = this.isEmpty();
    this.ctx.detectChanges();
    this.renderGraph();
  }

  private traverseTree(node: GraphNode) {
    const visibleNodes: Array<GraphNode> = [];
    const visibleLinks: Array<GraphLink> = [];

    visibleNodes.push(node);

    if(!node.collapsed) {
      visibleLinks.push(...node.childLinks);

      node.childLinks.forEach(childLink => {
        //3d Graph transforms links while rendering so they become objects
        const targetId = typeof(childLink.target) === 'string' ? childLink.target : (childLink.target as any).id;
        const childNode = this.nodesMap[targetId];

        const traversedTree = this.traverseTree(childNode);
        visibleNodes.push(...traversedTree.nodes);
        visibleLinks.push(...traversedTree.links);
      });
    }

    return { nodes: visibleNodes, links: visibleLinks };
  }

  private renderPrunedGraph() {
    this.graph.graphData(this.getPrunedTree());
  }

  private getPrunedTree() {
    const visibleNodes = [];
    const visibleLinks = [];

    this.rootNodes.forEach(rootNode => {
      const traversedTree = this.traverseTree(rootNode);
      visibleNodes.push(...traversedTree.nodes);
      visibleLinks.push(...traversedTree.links);
    });

    //Filter duplicates (if a node is pointed from multiple nodes, let's say a device contained in a room and managed
    // by another device
    const visibleNodesIds = [];
    const visibleNodesFiltered = [];
    visibleNodes.forEach(visibleNode => {
      if(!visibleNodesIds.includes(visibleNode.id)) {
        visibleNodesIds.push(visibleNode.id);
        visibleNodesFiltered.push(visibleNode);
      }
    });

    const visibleLinksIds = [];
    const visibleLinksFiltered = [];
    visibleLinks.forEach(visibleLink => {
      const sourceId = typeof (visibleLink.source) === 'string' ? visibleLink.source : (visibleLink.source as GraphNode).id;
      const targetId = typeof (visibleLink.target) === 'string' ? visibleLink.target : (visibleLink.target as GraphNode).id;
      const compositeId = sourceId + '_' + targetId;

      if(!visibleLinksIds.includes(compositeId)) {
        visibleLinksIds.push(compositeId);
        visibleLinksFiltered.push(visibleLink);
      }
    });

    return { nodes: visibleNodesFiltered, links: visibleLinksFiltered };
  }

  private getNameOrLabel(node: GraphNode | DeviceInfo): string {
    return node.name ? node.name : node.label;
  }

  private getAvailableDevicesForAuthUser(): Observable<PageData<DeviceInfo>> {
    const authUser = getCurrentAuthUser(this.store);

    //Get devices list from api
    const pageLink = new PageLink(100, 0);

    //Api to call is different, depending if authenticated user is tenant or customer
    let devicesListResult: Observable<PageData<DeviceInfo>> = null;
    if(authUser.authority === Authority.TENANT_ADMIN) {
      devicesListResult = this.ctx.deviceService.getTenantDeviceInfos(pageLink);
    } else {
      const customerId = authUser.customerId;
      devicesListResult = this.ctx.deviceService.getCustomerDeviceInfos(customerId, pageLink);
    }
    return devicesListResult;
  }

  private renderGraph() {
    if(!this.dataLoaded) {
      return;
    }

    this.graph =
      ForceGraph3D()(this.graphDomElement)
        .backgroundColor(this.graphBackgroundColor)
        .height(this.graphDomElement.clientHeight)
        .width(this.graphDomElement.clientWidth)
        .linkWidth(this.graphLinkWidth)
        .linkDirectionalArrowLength(this.graphLinkArrowLength)
        .linkDirectionalArrowRelPos(1)
        .linkLabel('relationType')
        .nodeVal((node: GraphNode) => {
          if(node.level === 0) {
            return this.rootNodeSpecialSettings ? this.rootNodeSize : this.graphNodeSize;
          }

          return this.graphNodeSize;
        })
        .nodeColor((node: GraphNode) => {
          if(node.level === 0 && this.rootNodeSpecialSettings) {
            return this.graphRootNodeColor;
          }

          if(node.collapsed) {
            return this.graphCollapsedNodeColor;
          }

          return node.entityType === EntityType.DEVICE ? this.graphDeviceNodeColor : this.graphAssetNodeColor;
        })
        .nodeThreeObject(node => {
          const sprite = new SpriteText(this.getNameOrLabel(node));
          sprite.color = node.color;
          sprite.textHeight = 8;

          // Cannot infer properties from parent, so have to type assert
          (sprite as THREE.Sprite).material.depthTest = false;
          (sprite as THREE.Sprite).material.depthWrite = false;
          (sprite as THREE.Sprite).renderOrder = 999;

          if(node.entityType == EntityType.DEVICE) {
            const imgTexture = new THREE.TextureLoader().load(this.deviceIcon);
            imgTexture.colorSpace = THREE.SRGBColorSpace;
            const material = new THREE.SpriteMaterial({ map: imgTexture, depthTest: false, depthWrite: false });
            const spriteImg = new THREE.Sprite(material);
            const size = 20;
            spriteImg.scale.set(size, size);
            spriteImg.position.set(0, 0.1, 0);
            spriteImg.renderOrder = 900;

            (sprite as THREE.Sprite).position.set(0, -(size), 0);
            const spriteGroup = new THREE.Group();
            spriteGroup.add(sprite);
            spriteGroup.add(spriteImg);
            // return spriteImg;
            return spriteGroup;

          }

          return sprite;

        })
        .nodeThreeObjectExtend(true)
        .nodeLabel(node => null)
        .onNodeHover((node: GraphNode) => {
          // Devices are not collapsible since they could be related to each other (circular graph)
          // The same is for assets without children
          if(!node || node.entityType == EntityType.DEVICE || !node.childLinks.length) {
            this.graphDomElement.style.cursor = 'default';
            return;
          }

          this.graphDomElement.style.cursor = node.collapsed ? 'crosshair' : 'grab';
        })
        .onNodeClick((node: GraphNode) => {
          this.closeRelationsTooltipIfOpened();

          if(!node || node.entityType == EntityType.DEVICE || !node.childLinks.length) {
            return;
          }

          // Toggle collapsed state
          node.collapsed = !node.collapsed;

          //Also fix position, because after collapsing, it could disappear from screen
          node.fx = node.x;
          node.fy = node.y;
          node.fz = node.z;

          this.renderPrunedGraph();
          this.graph.d3ReheatSimulation();
        })
        .onLinkClick(event => this.closeRelationsTooltipIfOpened())
        .onLinkRightClick(event => this.closeRelationsTooltipIfOpened())
        .onBackgroundClick(event => this.closeRelationsTooltipIfOpened())
        .onBackgroundRightClick(event => this.closeRelationsTooltipIfOpened())
        .onNodeRightClick((node: GraphNode, event) => {
          // If another tooltip was opened, close it
          this.closeRelationsTooltipIfOpened();

          //Only allow this kind of operation if authenticated user is a tenant or a customer (kind of users allowed to
          // have devices to query for)
          const authUser = getCurrentAuthUser(this.store);
          if(!authUser || (authUser.authority !== Authority.TENANT_ADMIN && authUser.authority !== Authority.CUSTOMER_USER)) {
            return;
          }

          const openedRelationsTooltipContainer = this.graphDomElement.querySelector('.scene-container') as HTMLElement;
          this.openedRelationsTooltip = new GUI( {
            container: openedRelationsTooltipContainer,
            title: this.getNameOrLabel(node)
          });

          //Specialize tooltip if it's an asset or device
          if(node.entityType === EntityType.ASSET) {
            //Exclude devices already contained into some other asset
            this.getAvailableDevicesForAuthUser()
              .pipe(
                map(pageData => {
                  return pageData.data.filter((deviceInfo) => {
                    return !this.graphData.nodes.some(
                      graphNode => {
                        return (graphNode.entityType === EntityType.ASSET &&
                          graphNode.childLinks.some(childLink => {
                            const target: GraphNode = childLink.target as unknown as GraphNode;
                            return target.entityType === EntityType.DEVICE && target.id === deviceInfo.id.id;
                          }));
                      }
                    );
                  });
                })
              )
              .subscribe(devicesOutput => {
                //Check if interface is still opened
                if(!this.openedRelationsTooltip) {
                  return;
                }

              const devicesList = {};
              devicesOutput.reduce((acc, item) => {
                acc[this.getNameOrLabel(item)] = item.id.id;
                return acc;
              }, devicesList);

              const addDeviceControl = {
                'Add device': null,
                'Confirm add': () => {
                  const deviceSelectedId = addDeviceControl["Add device"];
                  if(!deviceSelectedId) {
                    return;
                  }

                  //Find the object in devices obtained from API
                  const deviceObject = devicesOutput.find(singleDevice => singleDevice.id.id === deviceSelectedId);

                  //Create relation with asset and add to graph
                  this.ctx.entityRelationService.saveRelation({
                    to: {entityType: EntityType.DEVICE, id: deviceSelectedId},
                    type: CONTAINS_TYPE,
                    typeGroup: RelationTypeGroup.COMMON,
                    from: {entityType: EntityType.ASSET, id: node.id}})
                    .subscribe(() => {
                      this.addDeviceToGraphForRendering(CONTAINS_TYPE, node, deviceObject);
                    });
                }
              };
              const addDeviceField = this.openedRelationsTooltip.add(addDeviceControl, 'Add device', devicesList);
              const confirmButton = this.openedRelationsTooltip.add(addDeviceControl, 'Confirm add');
              //Disabled until a device is chosen
              confirmButton.disable();
              addDeviceField.onChange( value => {
                if(value) {
                  confirmButton.enable();
                }
              });

                // If asset already contains some device, display control to possibly remove them
                const containedDevices = this.graphData.links.filter(graphLink => {
                  const source = graphLink.source as GraphNode;
                  const target = graphLink.target as GraphNode;

                  return source.id === node.id && target.entityType === EntityType.DEVICE && graphLink.relationType === CONTAINS_TYPE;
                });

                if(containedDevices.length) {
                  const containedDevicesList = {};
                  containedDevices.reduce((acc, item) => {
                    const target = item.target as GraphNode;
                    acc[this.getNameOrLabel(target)] = target.id;
                    return acc;
                  }, containedDevicesList);

                  const removeDeviceCommand = 'Remove Device';
                  addDeviceControl[removeDeviceCommand] = null;
                  const removeDeviceConfirmCommand = 'Confirm remove';
                  addDeviceControl[removeDeviceConfirmCommand] = () => {
                    const deviceToRemoveSelectedId = addDeviceControl[removeDeviceCommand];
                    if(!deviceToRemoveSelectedId) {
                      return;
                    }
                    this.removeDeviceFromAsset(node, deviceToRemoveSelectedId);
                  };
                  const removeDeviceField = this.openedRelationsTooltip.add(addDeviceControl, removeDeviceCommand, containedDevicesList);
                  const confirmRemoveButton = this.openedRelationsTooltip.add(addDeviceControl, removeDeviceConfirmCommand);
                  //Disabled until a device to remove is chosen
                  confirmRemoveButton.disable();
                  removeDeviceField.onChange( value => {
                    if(value) {
                      confirmRemoveButton.enable();
                    }
                  });
                }
            });

          } else {
            // Find if this device is contained in an asset (could only by managed by another device)
            // const assetContainer = this.
            const assetContainer = this.graphData.nodes.find(graphNode =>
              graphNode.entityType === EntityType.ASSET &&
                graphNode.childLinks.some(
                  childLink =>
                    (childLink.target as unknown as GraphNode).entityType === EntityType.DEVICE && (childLink.target as unknown as GraphNode).id === node.id
                )
            );

            const deviceControlData  = {};
            if(assetContainer) {
              const removeKey = 'Remove from ' + this.getNameOrLabel(assetContainer);
              deviceControlData[removeKey] = () => { this.removeDeviceFromAsset(assetContainer, node.id) };
              this.openedRelationsTooltip.add(deviceControlData, removeKey);

              const moveKey = 'Move to another asset';
              const assetsList = {};
              this.graphData.nodes.forEach(graphNode => {
                if(graphNode.entityType === EntityType.ASSET && graphNode.id !== assetContainer.id) {
                  assetsList[this.getNameOrLabel(graphNode)] = graphNode.id;
                }
              });

              const moveConfirmKey = 'Move confirm';
              deviceControlData[moveKey] = null;
              deviceControlData[moveConfirmKey] = () => {
                const assetToMoveSelectedId = deviceControlData[moveKey];
                if(!assetToMoveSelectedId) {
                  return;
                }

                // Delete from old node and add to new (2 api calls)
                this.ctx.entityRelationService.deleteRelation(
                  {entityType: EntityType.ASSET, id: assetContainer.id},
                  CONTAINS_TYPE,
                  {entityType: EntityType.DEVICE, id: node.id}
                )
                  .pipe(
                    concatMap(() => this.ctx.entityRelationService.saveRelation(
                      {
                        from: {entityType: EntityType.ASSET, id: assetToMoveSelectedId},
                        to: {entityType: EntityType.DEVICE, id: node.id},
                        type: CONTAINS_TYPE,
                        typeGroup: RelationTypeGroup.COMMON
                      }
                      )
                    )
                  )
                  .subscribe(() => {
                    // Remove link from old parent
                    assetContainer.childLinks = assetContainer.childLinks.filter(childLink => {
                      const targetId = typeof (childLink.target) === 'string' ? childLink.target : (childLink.target as GraphNode).id;
                      return targetId !== node.id
                    });

                    // Find link in current graph and change source id to new node
                    const graphLinkToUpdate = this.graphData.links.find(graphLink => {
                      const sourceId = typeof (graphLink.source) === 'string' ? graphLink.source : (graphLink.source as GraphNode).id;
                      const targetId = typeof (graphLink.target) === 'string' ? graphLink.target : (graphLink.target as GraphNode).id;
                      return sourceId === assetContainer.id && targetId === node.id;
                    });
                    const newParent = this.graphData.nodes.find(graphNode => {
                      return graphNode.entityType === EntityType.ASSET && graphNode.id === assetToMoveSelectedId;
                    });
                    graphLinkToUpdate.source = newParent;
                    newParent.childLinks.push(graphLinkToUpdate);

                    this.renderPrunedGraph();
                  });

              };
              const moveDeviceField = this.openedRelationsTooltip.add(deviceControlData, moveKey, assetsList);
              const moveConfirmButton = this.openedRelationsTooltip.add(deviceControlData, moveConfirmKey);
              //Disabled until a device is chosen
              moveConfirmButton.disable();
              moveDeviceField.onChange( value => {
                if(value) {
                  moveConfirmButton.enable();
                }
              });

            }

            // Find if there are managable devices (not already managed by another device), and in this case, render option
            // to manage them
            this.getAvailableDevicesForAuthUser()
              .pipe(
                map(pageData => {
                  return pageData.data.filter((deviceInfo) => {
                    return deviceInfo.id.id !== node.id && !this.graphData.links.some(
                      graphLink => {
                        const source = graphLink.source as GraphNode;
                        const target = graphLink.target as GraphNode;

                        return (source.entityType === EntityType.DEVICE && graphLink.relationType === MANAGES_TYPE &&
                            target.id === deviceInfo.id.id);
                      }
                    );
                  });
                })
              )
              .subscribe(devicesOutput => {
                //Check if interface is still opened
                if(!this.openedRelationsTooltip) {
                  return;
                }

                const manageDevicesControl = {};

                if(devicesOutput.length){
                  // Could manage some 'free' device, so option is created for that purpose
                  const devicesList = {};
                  devicesOutput.reduce((acc, item) => {
                    acc[this.getNameOrLabel(item)] = item.id.id;
                    return acc;
                  }, devicesList);

                  const manageDeviceKey = 'Manage device';
                  const confirmManageDeviceKey = 'Confirm manage';
                  manageDevicesControl[manageDeviceKey] = null;
                  manageDevicesControl[confirmManageDeviceKey] = () => {

                    const deviceSelectedId = manageDevicesControl[manageDeviceKey];
                    if(!deviceSelectedId) {
                      return;
                    }

                    //Api call to create relation
                    this.ctx.entityRelationService.saveRelation(
                      {
                        from: { entityType: EntityType.DEVICE, id: node.id },
                        to: { entityType:EntityType.DEVICE, id: deviceSelectedId },
                        type: MANAGES_TYPE,
                        typeGroup: RelationTypeGroup.COMMON
                      }
                    )
                      .subscribe(() => {
                        // Create new node and add to processing list (retrieve potential subgraph with datasource query)
                        //Find the object in devices obtained from API
                        const deviceObject = devicesOutput.find(singleDevice => singleDevice.id.id === deviceSelectedId);
                        this.addDeviceToGraphForRendering(MANAGES_TYPE, node, deviceObject);
                      });
                  };
                  const manageDeviceField = this.openedRelationsTooltip.add(manageDevicesControl, manageDeviceKey, devicesList);
                  const confirmManageButton = this.openedRelationsTooltip.add(manageDevicesControl, confirmManageDeviceKey);

                  //Disabled until a device is chosen
                  confirmManageButton.disable();
                  manageDeviceField.onChange( value => {
                    if(value) {
                      confirmManageButton.enable();
                    }
                  });
                }

                //Check if this device already manages some other, in that case create the option to let them unmanage
                if(node.childLinks.length) {
                  const managedDevicesList = {};
                  node.childLinks.reduce((acc, item) => {
                    const target = item.target as GraphNode;
                    acc[this.getNameOrLabel(target)] = target.id;
                    return acc;
                  }, managedDevicesList);

                  const unmanageDeviceKey = 'Unmanage device';
                  const confirmUnmanageDeviceKey = 'Confirm unmanage';
                  manageDevicesControl[unmanageDeviceKey] = null;
                  manageDevicesControl[confirmUnmanageDeviceKey] = () => {
                    const deviceSelectedId = manageDevicesControl[unmanageDeviceKey];
                    if(!deviceSelectedId) {
                      return;
                    }

                    //Api call to create relation
                    //deleteRelation(fromId: EntityId, relationType: string, toId: EntityId, config?: RequestConfig): Observable<Object>;
                    this.ctx.entityRelationService.deleteRelation(
                      { entityType: EntityType.DEVICE, id: node.id },
                      MANAGES_TYPE,
                      { entityType:EntityType.DEVICE, id: deviceSelectedId }
                    )
                      .subscribe(() => {
                        const childLinkIndex = node.childLinks.findIndex((graphLink) => {
                          return (graphLink.target as GraphNode).id === deviceSelectedId;
                        });

                        const childlink = node.childLinks.splice(childLinkIndex, 1);

                        //Recursively remove subgraph of unamanaged device
                        this.removeSubgraph(childlink[0]);
                      });
                  };
                  const unmanageDeviceField = this.openedRelationsTooltip.add(manageDevicesControl, unmanageDeviceKey, managedDevicesList);
                  const confirmUnmanageButton = this.openedRelationsTooltip.add(manageDevicesControl, confirmUnmanageDeviceKey);

                  //Disabled until a device is chosen
                  confirmUnmanageButton.disable();
                  unmanageDeviceField.onChange( value => {
                    if(value) {
                      confirmUnmanageButton.enable();
                    }
                  });
                }

              });
          }

          //Check if interface is still opened
          if(!this.openedRelationsTooltip) {
            return;
          }

          //If tooltip is opened too much on the right, or in the bottom (nodes close to the scene container edges) adjust position
          if((this.openedRelationsTooltip.domElement.clientWidth + event.offsetX) > openedRelationsTooltipContainer.clientWidth) {
            this.openedRelationsTooltip.domElement.style.right = '0';
          } else {
            this.openedRelationsTooltip.domElement.style.left = event.offsetX + 'px';
          }

          if((this.openedRelationsTooltip.domElement.clientHeight + event.offsetY) > openedRelationsTooltipContainer.clientHeight) {
            this.openedRelationsTooltip.domElement.style.bottom = '0';
            this.openedRelationsTooltip.domElement.style.top = 'unset';
          } else {
            this.openedRelationsTooltip.domElement.style.top = event.offsetY + 'px';
          }

        })
    ;

    // If zoom, panning or rotation changes, close possible gui tooltips which coordinates don't match the node anymore
    (this.graph.controls() as HTMLElement).addEventListener( 'change', (input) => {
      this.closeRelationsTooltipIfOpened();
    } );

    this.renderPrunedGraph();
      // .zoomToFit(1000, 5, (node: object) => {
      //   // console.log('node include?');console.log(node);
      //   return true;
      // });

    if(this.fixPositionAfterDrag) {
      this.graph.onNodeDragEnd((node: GraphNode) => {
        node.fx = node.x;
        node.fy = node.y;
        node.fz = node.z;
      });
    }

    const linkForce = this.graph
      .d3Force('link')
      .distance(link => this.graphDistanceSize);

  }

  private addDeviceToGraphForRendering(relationType: string, parentNode: GraphNode, deviceObject: DeviceInfo) {
    // Add new graph relation for parent node
    const linkColor = relationType === MANAGES_TYPE ? this.graphLinkManagedDevicesColor : this.graphLinkColor;
    const graphLink: GraphLink  = {
      color: linkColor, relationType: relationType, source: parentNode.id, target: deviceObject.id.id
    };
    this.graphData.links.push(graphLink);

    //Create a 'datasource' for the new device node
    const addedDeviceDatasource: GraphNodeDatasource = {
      nodeId: deviceObject.id.id,
      entityId: deviceObject.id.id,
      entityLabel: deviceObject.label,
      entityName: deviceObject.name,
      entityType: EntityType.DEVICE,
      dataKeys: parentNode.datasource.dataKeys,
      filterId: parentNode.datasource.filterId
    };

    this.datasourceToNode(addedDeviceDatasource, (parentNode.level + 1));

    //Rerun traverse graph algorithm to find possible chain of managed device
    this.processNodes();
  }

  private removeDeviceFromAsset(parentNode: GraphNode, deviceId: string) {
    this.ctx.entityRelationService.deleteRelation(
      {id: parentNode.id, entityType: EntityType.ASSET},
      CONTAINS_TYPE,
      {id: deviceId, entityType: EntityType.DEVICE}
    ).subscribe(() => {
      //Remove relation from parent node
      const childLinkIndex = parentNode.childLinks.findIndex((graphLink) => {
        return (graphLink.target as GraphNode).id === deviceId;
      });

      const childlink = parentNode.childLinks.splice(childLinkIndex, 1);

      this.removeSubgraph(childlink[0]);
    });
  }

  private removeSubgraph(connectionToRemove: GraphLink) {
    const connectionsToRemove: GraphLink[] = [connectionToRemove];

    while (connectionsToRemove.length){
      const currentRemovingConnection = connectionsToRemove.shift();
      const removingSource = currentRemovingConnection.source as GraphNode;
      const removingTarget = currentRemovingConnection.target as GraphNode;

      // Remove relation from drawn graph
      this.graphData.links = this.graphData.links.filter(graphLink => {
        const source = graphLink.source as GraphNode;
        const target = graphLink.target as GraphNode;

        return source.id !== removingSource.id || target.id !== removingTarget.id;
      });

      //If the device has no more connections, remove it from graph recursively
      const hasOtherParentConnections = this.graphData.links.some((graphLink) => {
        return (graphLink.target as GraphNode).id === removingTarget.id;
      });
      if(!hasOtherParentConnections) {
        //Remove the node from graph
        const nodeToDeleteIndex = this.graphData.nodes.findIndex(node => {
          return node.id === removingTarget.id;
        });
        const deletedNode = this.graphData.nodes.splice(nodeToDeleteIndex, 1);

        // Test child links if something else has to be removed
        connectionsToRemove.push(...deletedNode[0].childLinks);
      }
    }

    this.renderPrunedGraph();
  }

  private closeRelationsTooltipIfOpened() {
    if(this.openedRelationsTooltip) {
      this.openedRelationsTooltip.close().destroy();
      this.openedRelationsTooltip = null;
    }
  }
}

/***
  * DOCS FOR CUSTOM WIDGET IN THINGSBOARD LIBRARY (BEFORE SAVING IN THINGSBOARD DEDICATED REPOSITORY)
 *
 * HTML TAB
 *
   <tb-entities-graph-widget [ctx]="ctx" [debugAssets]="['6b6d43b0-1465-11ef-a2b5-295f3faf72f6', '6b633190-1465-11ef-a2b5-295f3faf72f6']"></tb-entities-graph-widget>
  *
  * RESOURCES TAB
  *
 * import compiled development or release version of this library
 *
 * JAVASCRIPT TAB
 *
 self.onInit = function() {
   console.log('MAIN ONINIT should work');
  }

  self.onDataUpdated = function() {
  }

  self.onResize = function() {
    console.error('resize');
  }

  self.typeParameters = function() {

    return {
      dataKeysOptional: true
    };
  }

  self.onDestroy = function() {
  }

*/
