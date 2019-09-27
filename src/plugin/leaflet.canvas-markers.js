'use strict';

function layerFactory(L) {

    var CanvasIconLayer = (L.Layer ? L.Layer : L.Class).extend({
        initialize: function (options) {
            L.Util.setOptions(this, options);
            L.Util.stamp(this);
            //_latlngMarkers contains Lat\Long coordinates of all markers in layer.
            this._latlngMarkers = new rbush();
            this._latlngMarkers.dirty = 0;
            this._latlngMarkers.total = 0;
            //_markers contains Points of markers currently displaying on map
            this._markers = new rbush();
        },
        onAdd: function () {
            if (!this._container) {
                this._initContainer(); // defined by renderer implementations

                if (this._zoomAnimated) {
                    L.DomUtil.addClass(this._container, 'leaflet-zoom-animated');
                }

            }

            this.getPane().appendChild(this._container);
            L.DomUtil.toBack(this._container);
            this._update();
            this._updateCtx();
            this._draw();
        },
        onRemove: function () {
            this._destroyContainer();
        },
        getEvents: function () {
            var events = {
                viewreset: this._reset,
                zoom: this._redraw,
                moveend: this._redraw,
                mousemove: this._onMouseMove,
                click: this._onClick,
                mouseout: this._handleMouseOut
            };
            if (this._zoomAnimated) {
                events.zoomanim = this._onAnimZoom;
            }
            return events;
        },
        _onAnimZoom: function (ev) {
            this._updateTransform(ev.center, ev.zoom);
        },
        _onZoom: function () {
            this._updateTransform(this._map.getCenter(), this._map.getZoom());
        },
        _initContainer: function () {
            var container = this._container = document.createElement('canvas');
            this._ctx = container.getContext('2d');
        },
        _reset: function () {
            this._update();
            this._updateTransform(this._center, this._zoom);
            this._redraw();
        },
        _updateTransform: function (center, zoom) {
            if (!this._map)
                return;
            var scale = this._map.getZoomScale(zoom, this._zoom),
                position = L.DomUtil.getPosition(this._container),
                viewHalf = this._map.getSize().multiplyBy(0.5),
                currentCenterPoint = this._map.project(this._center, zoom),
                destCenterPoint = this._map.project(center, zoom),
                centerOffset = destCenterPoint.subtract(currentCenterPoint)

            this._topLeftOffset = viewHalf.multiplyBy(-scale).add(position).add(viewHalf).subtract(centerOffset);

            if (L.Browser.any3d) {
                L.DomUtil.setTransform(this._container, this._topLeftOffset, scale);
            } else {
                L.DomUtil.setPosition(this._container, this._topLeftOffset);
            }
        },
        clearLayers: function () {
			this._latlngMarkers.clear();
			this._markers.clear();
			this._clear();
            return;
        },
        _clear: function () {
            var bounds = this._redrawBounds;
            if (bounds) {
                var size = bounds.getSize();
                this._ctx.clearRect(bounds.min.x, bounds.min.y, size.x, size.y);
            } else {
                this._ctx.clearRect(0, 0, this._container.width, this._container.height);
            }
        },
        _redraw: function () {
            this._redrawRequest = null;

            if (this._redrawBounds) {
                this._redrawBounds.min._floor();
                this._redrawBounds.max._ceil();
            }
            this._update();
            this._clear(); // clear layers in redraw bounds
            this._draw(); // draw layers

            this._redrawBounds = null;
        },
        _destroyContainer: function () {
            this._markers.clear();
            this._container.remove();
            delete this._ctx;
            delete this._container;
        },
        _update: function () {
            if (!this._map)
                return;
            if (this._map._animatingZoom && this._bounds) { return; }

            var p = 0,
                size = this._map.getSize(),
                min = this._map.containerPointToLayerPoint(size.multiplyBy(-p)).round();

            this._bounds = new L.bounds(min, min.add(size.multiplyBy(1 + p * 2)).round());

            this._center = this._map.getCenter();
            this._zoom = this._map.getZoom();

            if (this._markers)
                this._markers.clear();

            var b = this._bounds,
                container = this._container,
                size = b.getSize(),
                m = L.Browser.retina ? 2 : 1;

            L.DomUtil.setPosition(container, b.min);
        },
        _updateCtx: function () {
            var b = this._bounds,
                container = this._container,
                size = b.getSize(),
                m = L.Browser.retina ? 2 : 1;

            // set canvas size (also clearing it); use double size on retina
            container.width = m * size.x;
            container.height = m * size.y;
            container.style.width = size.x + 'px';
            container.style.height = size.y + 'px';

            if (L.Browser.retina) {
                this._ctx.scale(2, 2);
            }
        },
        _draw: function () {
            var self = this;

            var bounds = self._redrawBounds;
            if (bounds) {
                var size = bounds.getSize();
                self._ctx.beginPath();
                self._ctx.rect(bounds.min.x, bounds.min.y, size.x, size.y);
                self._ctx.clip();
            }
            self._drawing = true;
            var tmp = [];
            //If we are 10% individual inserts\removals, reconstruct lookup for efficiency
            if (self._latlngMarkers.dirty / self._latlngMarkers.total >= .1) {
                self._latlngMarkers.all().forEach(function (e) {
                    tmp.push(e);
                });
                self._latlngMarkers.clear();
                self._latlngMarkers.load(tmp);
                self._latlngMarkers.dirty = 0;
                tmp = [];
            }
            var mapBounds = self._map.getBounds();

            //Only re-draw what we are showing on the map.
            self._latlngMarkers.search({
                minX: mapBounds.getWest(),
                minY: mapBounds.getSouth(),
                maxX: mapBounds.getEast(),
                maxY: mapBounds.getNorth()
            }).forEach(function (e) {
                //Readjust Point Map
                if (!e.data._map)
                    e.data._map = self._map;

                var pointPos = self._map.latLngToContainerPoint(e.data.getLatLng());


                var iconSize = e.data.options.icon.options.iconSize;
                var adj_x = iconSize[0] / 2;
                var adj_y = iconSize[1] / 2;

                tmp.push({
                    minX: (pointPos.x - adj_x),
                    minY: (pointPos.y - adj_y),
                    maxX: (pointPos.x + adj_x),
                    maxY: (pointPos.y + adj_y),
                    data: e.data
                });

                //Redraw points
                self._drawMarker(e.data, pointPos);
            });
            self._drawing = false;
            //Clear rBush & Bulk Load for performance
            self._markers.clear();
            self._markers.load(tmp);
        },
        _drawMarker: function (marker, pointPos) {
            var self = this;
            if (!this._imageLookup)
                this._imageLookup = {};

            if (!marker.canvas_img) {
                if (self._imageLookup[marker.options.icon.options.iconUrl]) {
                    marker.canvas_img = self._imageLookup[marker.options.icon.options.iconUrl][0];
                    if (self._imageLookup[marker.options.icon.options.iconUrl][1] === false) {
                        self._imageLookup[marker.options.icon.options.iconUrl][2].push([marker, pointPos]);
                    }
                    else {
                        self._drawImage(marker, pointPos);
                    }
                }
                else {
                    var i = new Image();
                    i.src = marker.options.icon.options.iconUrl;
                    marker.canvas_img = i;
                    //Image,isLoaded,marker\pointPos ref
                    self._imageLookup[marker.options.icon.options.iconUrl] = [i, false, [
                        [marker, pointPos]
                    ]
                    ];
                    i.onload = function () {
                        self._imageLookup[marker.options.icon.options.iconUrl][1] = true;
                        self._imageLookup[marker.options.icon.options.iconUrl][2].forEach(function (e) {
                            self._drawImage(e[0], e[1]);
                        });
                    }
                }
            } else if (self._imageLookup[marker.options.icon.options.iconUrl][1]) { // image may be not loaded / bad url
                self._drawImage(marker, pointPos);
            }
        },
        _drawImage: function (marker, pointPos) {
            if (!this._ctx)
                if (this._container)
                    this._ctx = this._container.getContext("2d");
                else
                    return;

            var options = marker.options.icon.options;
            var pos = pointPos.subtract(options.iconAnchor);
            this._ctx.drawImage(
                marker.canvas_img,
                pos.x,
                pos.y,
                options.iconSize[0],
                options.iconSize[1]
            );
        },
        _searchPoints: function (point) {
            return this._markers.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });
        },

        _onClick: function (e) {
            if (!this._markers) { return; }

            var self = this;
            var point = e.containerPoint;

            var layer_intersect = this._searchPoints(point);
            if (layer_intersect && layer_intersect.length > 0) {
                e.originalEvent.stopPropagation();
                var layer = layer_intersect[0].data
                layer.fire('click', e, true);
            }
        },
        _onMouseMove: function (e) {
            if (!this._markers || this._map.dragging.moving() || this._map._animatingZoom) { return; }

            var point = e.containerPoint;
            this._handleMouseHover(e, point);
        },
        _handleMouseHover: function (e, point) {
            var newHoverLayer;
            var layer_intersect = this._searchPoints(point);

            if (layer_intersect && layer_intersect.length > 0) {
                newHoverLayer = layer_intersect[0].data;
                var maxPoint = new L.Point(layer_intersect[0].maxX, layer_intersect[0].maxY);
                var minPoint = new L.Point(layer_intersect[0].minX, layer_intersect[0].minY);
                e.containerPoint = maxPoint.add(minPoint).divideBy(2).round();
            }

            if (newHoverLayer !== this._hoveredLayer) {
                this._handleMouseOut(e);

                if (newHoverLayer) {
                    L.DomUtil.addClass(this._container, 'leaflet-interactive');
                    this._hoveredLayer = newHoverLayer;
                    newHoverLayer.fire('mouseover', e, true);
                    e.originalEvent.stopPropagation();
                }
            }

            if (this._hoveredLayer) {
                this._hoveredLayer.fire('mouseover', e, true);
            }

        },
        _handleMouseOut: function (e) {
            var layer = this._hoveredLayer;
            if (layer) {
                // if we're leaving the layer, fire mouseout
                L.DomUtil.removeClass(this._container, 'leaflet-interactive');
                layer.fire('mouseout', e, true);
                this._hoveredLayer = null;
            }
        },
        //Multiple layers at a time for rBush performance
        addMarkers: function (markers, groupID) {
            var self = this;
            var tmpMark = [];
            var tmpLatLng = [];

            if (!self._groupIDs)
                self._groupIDs = {};

            if (!groupID)
                groupID = "0";
            else
                groupID = groupID.toString();

            var keys = Object.keys(self._groupIDs);
            for (var i = 0; i < keys.length; i++) {
                if (groupID === keys[0]) {
                    var add = true;
                    break;
                }
            }
            if (!add)
                self._groupIDs[groupID] = 0;

            markers.forEach(function (marker) {
                if (!((marker.options.pane == 'markerPane') && marker.options.icon)) {
                    console.error('Layer isn\'t a marker');
                    return;
                }
                var latlng = marker.getLatLng();
                var isDisplaying
                self._groupIDs[groupID]++;
                marker._canvasGroupID = groupID;

                if (self._map)
                    isDisplaying = self._map.getBounds().contains(latlng);
                else
                    isDisplaying = false;
                var s = self._addMarker(marker, latlng, isDisplaying);

                //Only add to Point Lookup if we are on map
                if (isDisplaying === true)
                    tmpMark.push(s[0]);

                tmpLatLng.push(s[1]);
            });
            self._markers.load(tmpMark);
            self._latlngMarkers.load(tmpLatLng);
        },
        //Adds single layer at a time. Less efficient for rBush
        addMarker: function (marker, groupID) {
            var self = this;
            var latlng = marker.getLatLng();
            var isDisplaying;

            if (!self._groupIDs)
                self._groupIDs = {};

            if (!groupID)
                groupID = "0";
            else
                groupID = groupID.toString();

            var keys = Object.keys(self._groupIDs);
            for (var i = 0; i < keys.length; i++) {
                if (groupID === keys[0]) {
                    var add = true;
                    break;
                }
            }
            if (add)
                self._groupIDs[groupID]++;
            else
                self._groupIDs[groupID] = 1;

            marker._canvasGroupID = groupID;

            if (self._map)
                isDisplaying = self._map.getBounds().contains(latlng);
            else
                isDisplaying = false;
            var dat = self._addMarker(marker, latlng, isDisplaying);

            //Only add to Point Lookup if we are on map
            if (isDisplaying === true)
                self._markers.insert(dat[0]);
            self._latlngMarkers.insert(dat[1]);
        },
        addLayer: function (layer, groupID) {
            if ((layer.options.pane == 'markerPane') && layer.options.icon)
                this.addMarker(layer,groupID);
            else console.error('Layer isn\'t a marker');
        },
        addLayers: function (layers, groupID) {
            this.addMarkers(layers,groupID);
        },
        removeGroups: function (groupIDs) {
            var self = this;
            if (Array.isArray(groupIDs)) {
                groupIDs.forEach(function (groupID) {
                    self._removeGroup(groupID);
                });
                this._redraw()
            }
        },
        removeGroup: function (groupID) {
            this._removeGroup(groupID);
            this._redraw();
        },
        _removeGroup: function (groupID) {
            var self = this;
            groupID = groupID.toString();

            var keys = Object.keys(self._groupIDs);
            for (var i = 0; i < keys.length; i++) {
                if (groupID === keys[i]) {
                    var removeAmt = self._groupIDs[groupID];

                    var a = self._latlngMarkers.all();
                    for (var r = 0; r < a.length;r++){
                        if (a[r].data._canvasGroupID === groupID) {
                            removeAmt--;
                            self._removeGeneric(a[r]);
                            if (removeAmt === 0)
                                break;
                        }
                    }

                    delete self._groupIDs[groupID];
                    break;
                }
            }

        },
        /*
        removeLayers: function (layers) {
            layers.forEach(function (e) {
                self.removeMarker(e, false);
            },this);
            this._redraw();
        },
        */
        removeLayer: function (layer) {
            this.removeMarker(layer, true);
        },
        removeMarker: function (marker, redraw) {
            var fn = function (a, b) {
                return a.data._leaflet_id === b.data._leaflet_id;
            };

            var self = this;
            //If we are removed point
            if (marker["minX"])
                marker = marker.data;
            var latlng = marker.getLatLng();
            var isDisplaying = self._map && self._map.getBounds().contains(latlng);
            var val = {
                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                data: marker
            };

            this._removeGeneric(val, fn);

            if (isDisplaying === true && redraw === true) {
                self._redraw();
            }
            marker.removeEventParent(this);
        },
        _removeGeneric: function (val, compareFn)
        {
            this._latlngMarkers.remove(val, compareFn);
            this._latlngMarkers.total--;
        },
        addTo: function (map) {
            map.addLayer(this);
            return this;
        },
        _addMarker: function (marker, latlng, isDisplaying) {
            var self = this;
            //Needed for pop-up & tooltip to work.
            if (self._map)
                marker._map = self._map;

            L.Util.stamp(marker);
            marker.addEventParent(self);

            if (self._map)
                var pointPos = self._map.latLngToContainerPoint(latlng);
            else
                var pointPos = L.point(0, 0);

            var iconSize = marker.options.icon.options.iconSize;

            var adj_x = iconSize[0] / 2;
            var adj_y = iconSize[1] / 2;

            var ret = [({
                minX: (pointPos.x - adj_x),
                minY: (pointPos.y - adj_y),
                maxX: (pointPos.x + adj_x),
                maxY: (pointPos.y + adj_y),
                data: marker
            }), ({
                minX: latlng.lng,
                minY: latlng.lat,
                maxX: latlng.lng,
                maxY: latlng.lat,
                data: marker
            })];

            self._latlngMarkers.dirty++;
            self._latlngMarkers.total++;

            //Only draw if we are on map
            if (isDisplaying === true)
                self._drawMarker(marker, pointPos);
            return ret;
        }
    });

    L.canvasIconLayer = function (options) {
        return new CanvasIconLayer(options);
    };

    return CanvasIconLayer;
};

module.exports = layerFactory;
