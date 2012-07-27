
var binfo = {
  numGroups: 35,
  tickSpacing: 46,
  compareHeightScale: 0.20,
  chartHeight: 200,
  chartPadding: 5,
  chartBorder: 5,
  maxLevels: 50,
  chartDimensions: {
    top: 20,
    right: 10,
    bottom: 20,
    left: 10,
    height: 100,
    width: 100,
    binWidth: 11
  }
};


binfo._register = (function() {

  "use strict";

  var components = {},
      componentNames = ['logic', 'hashRetrieval', 'charts',
                        'drag', 'setup', 'rendering'];

  return function(name, deps, component) {
    var names = componentNames;
    if (components[name] || names.indexOf(name) < 0) {
      return;
    }
    components[name] = {component: component, dependencies: deps};
    if (names.some(function(c) { return !components[c]; })) {
      return;
    }
    binfo._register = null;
    var dependencies = {},
        compFuncs = {},
        completed = {};

    names.forEach(function(c) {
      dependencies[c] = components[c].dependencies;
      compFuncs[c] = components[c].component;
    });

    function notCompleted(c) {
      return !completed[c];
    }

    function completeLoop(name) {
      var func = compFuncs[name],
          deps = dependencies[name],
          compDeps,
          me;
      if (completed[name]) return;
      if (deps.some(notCompleted)) return;
      compDeps = deps.map(function(d) { return completed[d]; });
      me = compFuncs[name].apply(null, compDeps);
      completed[name] = me ? me : true;
    }

    while (names.some(notCompleted)) {
      names.forEach(completeLoop);
    }
  };

}());


binfo._register('hashRetrieval', [], function() {

  "use strict";

  // Yarin's answer on this SO post:
  // http://stackoverflow.com/questions/4197591/
  // parsing-url-hash-fragment-identifier-with-javascript
  function getHashParams() {
    var hashParams = {};
    var e,
        a = /\+/g,  // Regex for replacing addition symbol with a space
        r = /([^&;=]+)=?([^&;]*)/g,
        d = function (s) { return decodeURIComponent(s.replace(a, ' ')); },
        q = window.location.hash.substring(1);

    e = r.exec(q);
    while (e) {
      hashParams[d(e[1])] = d(e[2]);
      e = r.exec(q);
    }
    return hashParams;
  }

  function renderFromHash() {
    var params = getHashParams();
    var dataName = params.data,
        charts = params.charts && params.charts.split(','),
        filters = params.filters && params.filters.split(',');

    var myFilters = {};
    if (filters) {
      filters.forEach(function(f) {
        var filterMap = f.split('*');
        myFilters[filterMap[0]] = filterMap.slice(1);
      });
    }
    if (!dataName || !charts || !charts.length) {
      return false;
    }
    binfo.render(dataName, charts, myFilters);
    return true;
  }

  window.onhashchange = renderFromHash;

  binfo.renderFromHash = renderFromHash;

});



binfo._register('rendering', ['setup', 'charts', 'logic'],
                function(setupApi, chartsApi, logicApi) {

  "use strict";

  var chartSelection,
      chartIds,
      cross,
      crossAll,
      currentCharts,
      currentDataName,
      currentHash,
      hashUpdatedRecently = false,
      hashNeedsUpdated = false,
      currentChartIds = [],
      currentShownChartIds = [],
      currentFilters = {},
      formatNumber = d3.format(',d');

  function arrayDiff(one, two) {
    return one.filter(function(id) {
      return two.indexOf(id) < 0;
    });
  }

  binfo.render = function(dataName, shownChartIds, filters, smartUpdate) {

    var dataSet = setupApi.dataSet(dataName);

    if (!dataSet) {
      setupApi.renderLater([dataName, shownChartIds, filters]);
      return;
    }

    filters = filters || currentFilters;
    var data = dataSet.data,
        holder = setupApi.holder(),
        chartsHolder = holder.select('.charts'),
        shownChartIds,
        chartData,
        charts = dataSet.charts,
        added,
        removed;

    chartIds = shownChartIds.slice();

    chartData = shownChartIds.map(function(id, i) {
      if (!charts[id]) {
        // Must be a compare chart
        charts[id] = chartsApi.compareChart({id: id, charts: charts});
      }
      if (charts[id].compare) {
        chartIds = charts[id].addChartIds(chartIds);
      }
      return {
        chart: charts[id],
        compare: charts[id].compare,
        orientFlip: charts[id].defaultOrientFlip
      };
    });

    removed = arrayDiff(currentChartIds, chartIds);
    added = arrayDiff(chartIds, currentChartIds);

    if (!cross || currentDataName !== dataName || removed.length || added.length) {
      if (smartUpdate) {
        return false;
      }
      if (chartsHolder.style('opacity') > 0.4) {;
        chartsHolder.style('opacity', 0.3);
        setTimeout(function() {
          binfo.render(dataName, shownChartIds, filters);
        }, 30);
        return true;
      }
    }
    if (!cross || currentDataName !== dataName || removed.length) {
      cross = crossfilter(data);
      crossAll = cross.groupAll();
      added = chartIds;
    }

    removed.forEach(function(id) {
      filters[id] = null;
      currentCharts[id].filter(null);
    });


    currentCharts = charts;
    currentChartIds = chartIds;
    currentShownChartIds = shownChartIds;
    currentDataName = dataName;
    currentFilters = filters;

    setupApi.updateUponRender(dataName, shownChartIds);
    updateHash();

    added.forEach(function(id) {
      if (!charts[id].compare) charts[id].setCross(cross, crossAll);
    });
    added.forEach(function(id) {
      if (charts[id].compare) charts[id].setCross(cross, crossAll);
    });

    chartSelection = chartsHolder.selectAll('.chart')
        .data(chartData, function(d) { return d.chart.id; });

    chartSelection.enter()
      .append('div')
        .attr('class', 'chart')
      .append('div')
        .attr('class', 'title');

    chartSelection.exit().remove();

    chartSelection.order();

    chartsHolder.style('opacity', null);
    holder.select('.total')
        .text(formatNumber(cross.size()) + ' ' + dataName + ' selected.');

    chartIds.forEach(function(id) {
      if (filters[id]) {
        charts[id].filter(filters[id]);
      } else {
        charts[id].filter(null);
      }
    });

    renderAll();

    arrangeCharts();

    return true;

  };

  function arrangeCharts() {
    var dims = {},
        widths = [],
        maxWidth = binfo.width,
        maxLevel = 0,
        i;
    chartSelection.each(function(d) {
      var height = this.offsetHeight - binfo.chartBorder,
          levels = Math.ceil(height / binfo.chartHeight);
      height = levels * binfo.chartHeight - (binfo.chartBorder +
                                             2 * binfo.chartPadding);
      d3.select(this).style('height', height + 'px');
      dims[d.chart.id] = {
        levels: levels,
        width: this.offsetWidth - binfo.chartBorder
      };
    });

    for (i = 0; i < binfo.maxLevels; i++) {
      widths[i] = maxWidth;
    }
    currentShownChartIds.forEach(function(id) {
      var chart = currentCharts[id],
          levels = dims[id].levels,
          width = dims[id].width,
          fitting = 0,
          fitWidth,
          i,
          j;
      for (i = 0; i < widths.length; i++) {
        if (widths[i] >= width || widths[i] === maxWidth) {
          if (widths[i] === fitWidth) {
            fitting += 1;
          } else {
            fitWidth = widths[i];
            fitting = 1;
          }
        }
        if (fitting === levels) {
          break;
        }
      }
      for (j = i - levels + 1; j <= i; j++) {
        widths[j] -= width;
      }
      maxLevel = Math.max(i, maxLevel);
      dims[id].left = maxWidth - fitWidth;
      dims[id].top = (i - levels + 1) * binfo.chartHeight;
    });

    chartSelection.each(function(d) {
      var dim = dims[d.chart.id];
      d3.select(this)
          .style('left', dim.left + 'px')
          .style('top', dim.top + 'px');
    });

    var chartHolderHeight = (maxLevel + 1) * binfo.chartHeight + 200,
        holder = setupApi.holder();
    holder.select('.charts').style('height', chartHolderHeight + 'px');
  };

  function updateHash() {
    var filter, filterData,
        chartString = 'charts=',
        filterString = 'filters=',
        filterArray = [];

    chartString += currentShownChartIds.map(function(id) {
      return currentCharts[id].id;
    }).join(',');

    function filterEncode(d) {
      if (typeof d === 'object') {
        d = d.valueOf();
      }
      return encodeURIComponent(d);
    }
    for (filter in currentFilters) {
      if (currentFilters.hasOwnProperty(filter) && currentFilters[filter]) {
        filterData = currentFilters[filter].map(filterEncode).join('*');
        filterArray.push(filter + '*' + filterData);
      }
    }
    filterString += filterArray.join(',');
    var params = ['data=' + currentDataName, chartString, filterString].join('&');
    currentHash = '#' + params;
    hashNeedsUpdated = true;
    if (!hashUpdatedRecently) {
      updateWindowHash();
    }
  }

  function updateWindowHash() {
    hashUpdatedRecently = false;
    if (hashNeedsUpdated) {
      window.history.replaceState({}, '', currentHash);
      setTimeout(updateWindowHash, 300);
      hashUpdatedRecently = true;
      hashNeedsUpdated = false;
    }
  }

  chartsApi.filter = function(id, range) {
    currentFilters[id] = range;
    currentCharts[id].filter(range);
    renderAll();
    updateHash();
  };

  chartsApi.given = function(id, given) {
    chartsApi.filter(id, given ? [given] : null);
  };

  function callCharts(name) {
    return function(chartData) {
      /*jshint validthis:true */
      var method = chartData.chart[name];
      if (method) {
        d3.select(this).each(method);
      }
    };
  }

  var renderCharts = callCharts('render'),
      cleanUpCharts = callCharts('cleanUp');

  function renderAll() {
    chartIds.forEach(function(id) { currentCharts[id].update(); });
    chartSelection.each(renderCharts);
    chartSelection.each(cleanUpCharts);
    d3.select('.active-data').text(formatNumber(crossAll.value()));
  }

});

