'use strict';

function layerFactory(L) {

    var CanvasIconLayer = (L.Layer ? L.Layer : L.Class).extend({
        options: {
            // @option padding: Number = 0.1
            // How much to extend the clip area around the map view (relative to its size)
            // e.g. 0.1 would be 10% of map view in each direction
            padding: L.Canvas.prototype.options.padding
        },

        initialize: function (options) {
            L.Util.setOptions(this, options);
            L.Util.stamp(this);
        },
        onAdd: function () {
            //if (!this._container) {
                this._initContainer(); // defined by renderer implementations

                if (this._zoomAnimated) {
                    L.DomUtil.addClass(this._container, 'leaflet-zoom-animated');
                }

            //} // TODO: this is temporary fix to keep container on remove

            this.getPane().appendChild(this._container);
            L.DomUtil.toBack(this._container);
            this._update();
            this._updateTransform(this._center, this._zoom); // TODO: refactor all these update/redraw sequences into common functions
            this._updateCtx();
            this._draw();
        },
        onRemove_bak: function () {
            this._destroyContainer();
        }, // TODO: this is temporary fix to keep container on remove
        onRemove: function () {
            this._map.off('moveend', this._redraw, this); // TODO: 'moveend' seems enough (https://github.com/IITC-CE/Leaflet.Canvas-Markers/issues/11)
            this._map.off('mousemove', this._onMouseMove, this);
            this._map.off('click', this._onClick, this);
            this._map.off('mouseout', this._handleMouseOut, this);
            this._map.off('zoomanim', this._onAnimZoom, this);
            this._container.remove();
        },
        _onAnimZoom: function (ev) {
            this._updateTransform(ev.center, ev.zoom);
        },

        _onZoom: function () {
            this._updateTransform(this._map.getCenter(), this._map.getZoom());
        },
        getEvents: function () {
            return {};
        },
        _initContainer: function () {
            var container = this._container = this._container || document.createElement('canvas'); // TODO: this is temporary fix to keep container on remove

            this._map.on('moveend', this._redraw, this); // TODO: 'moveend' seems enough (https://github.com/IITC-CE/Leaflet.Canvas-Markers/issues/11)
            this._map.on('mousemove', this._onMouseMove, this);
            this._map.on('click', this._onClick, this);
            this._map.on('mouseout', this._handleMouseOut, this);
            if (this._zoomAnimated) {
                this._map.on('zoomanim', this._onAnimZoom, this);
            }

            this._ctx = container.getContext('2d');
        },
        _updateTransform: function (center, zoom) {
            if (!this._map)
                return;
            var scale = this._map.getZoomScale(zoom, this._zoom),
                position = L.DomUtil.getPosition(this._container),
                viewHalf = this._map.getSize().multiplyBy(0.5 + this.options.padding),
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
            this._updateTransform(this._center, this._zoom);
            this._clear(); // clear layers in redraw bounds
            this._updateCtx();
            this._draw(); // draw layers

            this._redrawBounds = null;
        },
        _destroyContainer: function () {
            delete this._markers;
            delete this._latlngMarkers;
            delete this._ctx;
            this._map.off('moveend', this._redraw, this);  // TODO: 'moveend' seems enough (https://github.com/IITC-CE/Leaflet.Canvas-Markers/issues/11)
            this._map.off('mousemove', this._onMouseMove, this);
            this._map.off('click', this._onClick, this);
            this._map.off('mouseout', this._handleMouseOut, this);
            this._container.remove();
            delete this._container;
        },
        _update: function () {
            if (!this._map)
                return;
            if (this._map._animatingZoom && this._bounds) { return; }

            var p = this.options.padding,
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
        // @method pad(bufferRatio: Number): array
        // Returns bounds created by extending or retracting the current bounds by a given ratio in each direction.
        // For example, a ratio of 0.5 extends the bounds by 50% in each direction.
        // Negative values will retract the bounds.
        pad: function (mapBounds, bufferRatio) {
            var sw = mapBounds._southWest,
                ne = mapBounds._northEast,
                heightBuffer = Math.abs(sw.lat - ne.lat) * bufferRatio,
                widthBuffer = Math.abs(sw.lng - ne.lng) * bufferRatio;

            return [widthBuffer, heightBuffer];
        },
        _draw: function () {
            var self = this;
            //If no markers don't draw
            if (!self._latlngMarkers)
                return;

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
            var _pad = self.pad(mapBounds, self.options.padding);

            //Only re-draw what we are showing on the map.
            self._latlngMarkers.search({
                minX: mapBounds.getWest()-_pad[0],
                minY: mapBounds.getSouth()-_pad[1],
                maxX: mapBounds.getEast()+_pad[0],
                maxY: mapBounds.getNorth()+_pad[1]
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

            var iconAnchor = L.point(marker.options.icon.options.iconAnchor);
            var pos = this._map.containerPointToLayerPoint(pointPos.subtract(iconAnchor).subtract(this._topLeftOffset?this._topLeftOffset:L.Point(0,0)));

            this._ctx.drawImage(
                marker.canvas_img,
                pos.x,
                pos.y,
                marker.options.icon.options.iconSize[0],
                marker.options.icon.options.iconSize[1]
            );
        },
        _searchPoints: function (point) {
            return this._markers.search({ minX: point.x, minY: point.y, maxX: point.x, maxY: point.y });
        },
        on: function (types, fn, context) { // TODO: this is temporary fix to handle all leaflet events (not only internal)
            var internal = ['click', 'mouseover', 'mouseout'];
            var self = this;
            if (!self._userEvents)
                self._userEvents = {};
            L.Util.splitWords(types).forEach(function (type) {
                if (internal.indexOf(type) === -1) {
                    L.Evented.prototype._on.call(self, type, fn, context);
                } else {
                    self._userEvents[type] = fn;
                }
            });
            return this;
        },
        _onClick: function (e) {
            if (!this._markers) { return; }

            var self = this;
            var point = e.containerPoint;

            var layer_intersect = this._searchPoints(point);
            if (layer_intersect && layer_intersect.length > 0) {
                e.originalEvent.stopPropagation();
                var layer = layer_intersect[0].data
                e.target = layer;
                var maxPoint = new L.Point(layer_intersect[0].maxX, layer_intersect[0].maxY);
                var minPoint = new L.Point(layer_intersect[0].minX, layer_intersect[0].minY);
                e.containerPoint = maxPoint.add(minPoint).divideBy(2).round();
                if (layer.listens('click')) {
                    layer.fire('click', e);
                }
                else if (self._userEvents.click) {
                    self._userEvents['click'].call(layer, e);
                }
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
                    e.target = newHoverLayer;
                    if (newHoverLayer.listens('mouseover')) {
                        newHoverLayer.fire('mouseover', e);
                    }
                    else if (this._userEvents.mouseover) {
                        this._userEvents['mouseover'].call(newHoverLayer, e);
                    }
                    e.originalEvent.stopPropagation();
                }
            }

            if (this._hoveredLayer) {
                e.target = this._hoveredLayer;
                if (this._hoveredLayer.listens('mouseover')) {
                    this._hoveredLayer.fire('mouseover', e);
                }
                else if (this._userEvents.mouseover) {
                    this._userEvents['mouseover'].call(this._hoveredLayer, e);
                }
            }

        },
        _handleMouseOut: function (e) {
            var layer = this._hoveredLayer;
            if (layer) {
                // if we're leaving the layer, fire mouseout
                L.DomUtil.removeClass(this._container, 'leaflet-interactive');
                e.target = layer;
                if (layer.listens('mouseout')) {
                    layer.fire('mouseout', e);
                }
                else if (this._userEvents.mouseout) {
                    this._userEvents['mouseout'].call(layer, e);
                }
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
        removeLayers: function (layers) {
            var self = this;
            layers.forEach(function (e) {
                self.removeMarker(e, false);
            });
            if (redraw && redraw === true)
                self.redraw();
        },
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

            //_markers contains Points of markers currently displaying on map
            if (!self._markers) self._markers = new rbush();

            //_latlngMarkers contains Lat\Long coordinates of all markers in layer.
            if (!self._latlngMarkers) {
                self._latlngMarkers = new rbush();
                self._latlngMarkers.dirty = 0;
                self._latlngMarkers.total = 0;
            }

            L.Util.stamp(marker);

            if (self._map)
                var pointPos = self._map.latLngToContainerPoint(latlng);
            else
                var pointPos = L.point(0, 0);

			var iconOptions = marker.options.icon.options;
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
