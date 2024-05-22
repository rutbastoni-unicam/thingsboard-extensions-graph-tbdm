import {Component, OnInit, ElementRef, AfterViewInit, ViewContainerRef} from '@angular/core';
import { PageComponent } from '@shared/public-api';
import { UtilsService} from '@core/public-api';

import { Overlay } from '@angular/cdk/overlay';
import { FormBuilder } from '@angular/forms';
import { Store } from '@ngrx/store';
import { AppState } from '@core/core.state';
// import * as console from "console";

@Component({
  selector: 'tb-entities-graph-widget',
  templateUrl: 'entities.graph.widget.component.html',
  styleUrls: ['entities.graph.widget.component.scss']
})
export class EntitiesGraphWidgetComponent extends PageComponent implements OnInit, AfterViewInit   {
  constructor(protected store: Store<AppState>,
              private elementRef: ElementRef,
              private overlay: Overlay,
              private viewContainerRef: ViewContainerRef,
              private utils: UtilsService,
              private fb: FormBuilder) {
    super(store);
  }

  ngOnInit() {
    console.log('>>> it works oninit internal mywidget');
  }

  ngAfterViewInit(): void {
    // console.log('>>> it works ngAfterViewInit internal mywidget');
  }
}
