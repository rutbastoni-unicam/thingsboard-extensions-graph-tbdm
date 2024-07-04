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
  Datasource,
  DatasourceType,
  DeviceInfo,
  EntityRelationsQuery,
  EntitySearchDirection,
  EntityType,
  PageComponent,
  PageData,
  PageLink,
  RelationTypeGroup,
  WidgetConfig,
  widgetType,
  CONTAINS_TYPE
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
import {map, Observable} from "rxjs";

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
  private graphNodeSize: number;
  private graphDistanceSize: number;
  private graphLinkWidth: number;
  private graphLinkColor: string;
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
    this.graphNodeSize = graphSettings?.nodeSize || defaultGraphSettings.nodeSize;
    this.graphDistanceSize = graphSettings?.linkDistance || defaultGraphSettings.linkDistance;
    this.graphLinkWidth = graphSettings?.linkWidth || defaultGraphSettings.linkWidth;
    this.graphLinkColor = graphSettings?.linkColor || defaultGraphSettings.linkColor;
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
                  color: this.graphLinkColor
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

    this.graphData.links.forEach(link => {
      this.nodesMap[link.source].childLinks.push(link);
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

  private getPrunedTree() {
    const visibleNodes = [];
    const visibleLinks = [];

    this.rootNodes.forEach(rootNode => {
      const traversedTree = this.traverseTree(rootNode);
      visibleNodes.push(...traversedTree.nodes);
      visibleLinks.push(...traversedTree.links);
    });

    return { nodes: visibleNodes, links: visibleLinks };
  }

  private getNameOrLabel(node: GraphNode | DeviceInfo): string {
    return node.name ? node.name : node.label;
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
          return node.entityType == EntityType.DEVICE ? '#ffffff' : '#ffffaa';
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

          this.graph.graphData(this.getPrunedTree());
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

          this.openedRelationsTooltip = new GUI( {
            container: this.graphDomElement.querySelector('.scene-container'),
            title: this.getNameOrLabel(node)
          });

          //Specialize tooltip if it's an asset or device
          if(node.entityType == EntityType.ASSET) {
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

            //Exclude devices already contained into some other asset
            devicesListResult
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
                'Confirm': () => {
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
                      //Update the graph!
                      const deviceGraphNode: GraphNode = {
                        childLinks: [],
                        childrenNodesLoaded: false,
                        datasource: undefined,
                        entityType: EntityType.DEVICE,
                        id: deviceSelectedId,
                        label: deviceObject.label,
                        level: (node.level + 1),
                        name: deviceObject.name
                      };
                      this.graphData.nodes.push(deviceGraphNode);
                      const graphLink: GraphLink  = {
                        color: this.graphLinkColor, relationType: CONTAINS_TYPE, source: node.id, target: deviceSelectedId
                      };
                      this.graphData.links.push(graphLink);
                      this.graph.graphData(this.graphData);

                      //TODO get possibile managed devices
                    });
                }
              };
              const addDeviceField = this.openedRelationsTooltip.add(addDeviceControl, 'Add device', devicesList);
              const confirmButton = this.openedRelationsTooltip.add(addDeviceControl, 'Confirm');
              //Disabled until a device is chosen
              confirmButton.disable();
              addDeviceField.onChange( value => {
                if(value) {
                  confirmButton.enable();
                }
              });
            });

          } else {
            // controls
            const key = 'DAG ' + node.name;
            const controls = { key: 'lr'};
            const control2s = { test: 'lr'};

            this.openedRelationsTooltip.add(controls, key, ['lr', 'td', 'zout', 'radialout', null]);
            this.openedRelationsTooltip.add(control2s, 'Work in progress', ['lr', 'td', 'zout', 'radialout', null])
              .onChange(orientation => { console.error('dat ' + orientation);});
          }

          // nodeToProcess.entityType === EntityType.ASSET ? [EntityType.ASSET, EntityType.DEVICE] : [EntityType.DEVICE];

          //TODO if too much on right, calc left to make it visible
          this.openedRelationsTooltip.domElement.style.top = event.offsetY + 'px';
          this.openedRelationsTooltip.domElement.style.left = event.offsetX + 'px';
          (window as any).myguiinstance = this.openedRelationsTooltip;
        })
    ;

    // If zoom, panning or rotation changes, close possible gui tooltips which coordinates don't match the node anymore
    (this.graph.controls() as HTMLElement).addEventListener( 'change', (input) => {
      this.closeRelationsTooltipIfOpened();
    } );

    this.graph.graphData(this.graphData);
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
