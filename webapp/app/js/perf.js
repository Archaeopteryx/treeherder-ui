/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var perf = angular.module("perf", ['ui.router', 'ui.bootstrap']);

/* Copied from providers.js */
perf.provider('thServiceDomain', function() {
    this.$get = function() {
        if (window.thServiceDomain) {
            return window.thServiceDomain;
        } else {
            return "";
        }
    };
});

perf.factory('getSeriesSummary', [ function() {
  return function(signature, signatureProps, optionCollectionMap) {
    var platform = signatureProps.machine_platform + " " +
      signatureProps.machine_architecture;
    var extra = "";
    if (signatureProps.job_group_symbol === "T-e10s") {
      extra = " e10s";
    }
    var testName = signatureProps.test;
    var subtestSignatures;
    if (testName === undefined) {
      testName = "summary";
      subtestSignatures = signatureProps.subtest_signatures;
    }
    var name = signatureProps.suite + " " + testName +
      " " + optionCollectionMap[signatureProps.option_collection_hash] + extra;
    var signatureName = name;

    return { name: name, signature: signature, platform: platform,
             subtestSignatures: subtestSignatures };
  };
}]);

perf.controller('PerfCtrl', [ '$state', '$stateParams', '$scope', '$rootScope', '$location',
                              '$modal', 'thServiceDomain', '$http', '$q', '$timeout', 'getSeriesSummary',
  function PerfCtrl($state, $stateParams, $scope, $rootScope, $location, $modal,
                    thServiceDomain, $http, $q, $timeout, getSeriesSummary) {

    var availableColors = [ 'red', 'green', 'blue', 'orange', 'purple' ];

    $scope.timeranges = [
      { "value":86400, "text": "Last day" },
      { "value":604800, "text": "Last 7 days" },
      { "value":1209600, "text": "Last 14 days" },
      { "value":2592000, "text": "Last 30 days" },
      { "value":5184000, "text": "Last 60 days" },
      { "value":7776000, "text": "Last 90 days" } ];

    if ($stateParams.timerange) {
      for (var i in $scope.timeranges) {
        var timerange = $scope.timeranges[i];
        if (timerange.value == $stateParams.timerange) {
          $scope.myTimerange = timerange;
          break;
        }
      }
    }

    $scope.ttHideTimer = null;

    $scope.selectedDataPoint = null;

    function getSeriesDataPoint(flotItem) {
      // gets universal elements of a series given a flot item

      // sometimes we have multiple results with the same result id, in
      // which case we need to calculate an offset to it (I guess
      // technically even this is subject to change in the case of
      // retriggers but oh well, hopefully this will work for 99%
      // of cases)
      var resultSetId = flotItem.series.resultSetData[flotItem.dataIndex];

      return {
        projectName: flotItem.series.thSeries.projectName,
        signature: flotItem.series.thSeries.signature,
        resultSetId: resultSetId,
        flotDataOffset: (flotItem.dataIndex -
                         flotItem.series.resultSetData.indexOf(resultSetId))
      };
    }

    function deselectDataPoint() {
      $timeout(function() {
        $scope.selectedDataPoint = null;
      });
    }

    function showTooltip(dataPoint) {
      if ($scope.ttHideTimer) {
        clearTimeout($scope.ttHideTimer);
        $scope.ttHideTimer = null;
      }

      var phSeriesIndex = _.findIndex(
        $scope.seriesList,
        function(s) {
          return s.projectName == dataPoint.projectName &&
            s.signature == dataPoint.signature;
        });
      var phSeries = $scope.seriesList[phSeriesIndex];

      // we need the flot data for calculating values/deltas and to know where
      // on the graph to position the tooltip
      var flotData = {
        series: _.find($scope.plot.getData(), function(fs) {
          return fs.thSeries.projectName == dataPoint.projectName &&
            fs.thSeries.signature == dataPoint.signature;
        }),
        pointIndex: phSeries.flotSeries.resultSetData.indexOf(
          dataPoint.resultSetId) + dataPoint.flotDataOffset
      };

      var prevDataPointIndex = (flotData.pointIndex - dataPoint.flotDataOffset - 1);
      var flotSeriesData = flotData.series.data;

      var t = flotSeriesData[flotData.pointIndex][0],
          v = flotSeriesData[flotData.pointIndex][1],
          v0 = (prevDataPointIndex >= 0) ? flotSeriesData[prevDataPointIndex][1] : v,
          dv = v - v0,
          dvp = v / v0 - 1;

      $scope.tooltipContent = {
        revision: "(loading revision...)",
        revisionHref:  "",
        branch: dataPoint.projectName,
        test: phSeries.name,
        platform: phSeries.platform,
        machine: phSeries.machine || 'mean',
        value: Math.round(v*1000)/1000,
        deltaValue: dv.toFixed(1),
        deltaPerfcentValue: (100 * dvp).toFixed(1),
        date: $.plot.formatDate(new Date(t), '%a %b %d, %H:%M:%S')
      };

      $http.get(thServiceDomain + '/api/project/' + phSeries.projectName +
                '/resultset/' + dataPoint.resultSetId).then(
                  function(response) {
                    var revision = response.data.revisions[0].revision;
                    $scope.tooltipContent.revision = revision;
                    dataPoint.revision = revision;
                    var project = _.findWhere($scope.projects,
                                              { name: phSeries.projectName });
                    $scope.tooltipContent.revisionHref = (project.url +
                                                          "/rev/" + revision);
                  });

      // now position it
      $timeout(function() {
        var x = parseInt(flotData.series.xaxis.p2c(t) +
                         $scope.plot.offset().left);
        var y = parseInt(flotData.series.yaxis.p2c(v) +
                         $scope.plot.offset().top);

        var tip = $('#graph-tooltip');
        function getTipPosition(tip, x, y, yoffset) {
          return {
            left: x - tip.width() / 2,
            top: y - tip.height() - yoffset
          };
        }

        tip.stop(true);

        // first, reposition tooltip (width/height won't be calculated correctly
        // in all cases otherwise)
        var tipPosition = getTipPosition(tip, x, y, 10);
        tip.css({ left: tipPosition.left, top: tipPosition.top });

        // get new tip position after transform
        var tipPosition = getTipPosition(tip, x, y, 10);
        if (tip.css('visibility') == 'hidden') {
          tip.css({ opacity: 0, visibility: 'visible', left: tipPosition.left,
                    top: tipPosition.top + 10 });
          tip.animate({ opacity: 1, left: tipPosition.left,
                        top: tipPosition.top }, 250);
        } else {
          tip.css({ opacity: 1, left: tipPosition.left, top: tipPosition.top });
        }
      });
    }

    function hideTooltip(now) {
      var tip = $('#graph-tooltip');

      if (!$scope.ttHideTimer && tip.css('visibility') == 'visible') {
        $scope.ttHideTimer = setTimeout(function() {
          $scope.ttHideTimer = null;
          tip.animate({ opacity: 0, top: '+=10' },
                      250, 'linear', function() {
                        $(this).css({ visibility: 'hidden' });
                      });
        }, now ? 0 : 250);
      }
    }

    Mousetrap.bind('escape', function() {
      deselectDataPoint();
    });

    // Highlight the points persisted in the url
    function highlightDataPoints() {
      $scope.plot.unhighlight();

      // if we have a highlighted revision, highlight all points that
      // correspond to that
      $scope.seriesList.forEach(function(series, i) {
        if (series.highlighted) {
          if (series.highlighted.length > 0 && series.visible) {
            $scope.resetHighlightButton = true;
            $scope.revisionToHighlight = series.highlighted[1];
            $scope.plot.highlight(i, series.highlighted[0]);
          }
        }
      });

      // also highlighted the selected item (if there is one)
      if ($scope.selectedDataPoint) {
        var selectedSeriesIndex = _.findIndex(
          $scope.seriesList,
          function(s) {
            return s.projectName == $scope.selectedDataPoint.projectName &&
              s.signature == $scope.selectedDataPoint.signature;
          });
        var selectedSeries = $scope.seriesList[selectedSeriesIndex];
        var flotDataPoint = selectedSeries.flotSeries.resultSetData.indexOf(
          $scope.selectedDataPoint.resultSetId) + $scope.selectedDataPoint.flotDataOffset;
        $scope.plot.highlight(selectedSeriesIndex, flotDataPoint);
      }
    }

    function plotOverviewGraph() {
      // We want to show lines for series in the overview plot, if they are visible
      $scope.seriesList.forEach(function(series) {
        series.flotSeries.points.show = false;
        series.flotSeries.lines.show = series.visible;
      });

      $scope.overviewPlot = $.plot($("#overview-plot"),
                              $scope.seriesList.map(
                                function(series) {
                                 return series.flotSeries }),
                                 {
                                   xaxis: { mode: 'time' },
                                   selection: { mode: 'xy', color: '#97c6e5' },
                                   series: { shadowSize: 0 },
                                   lines: { show: true },
                                   points: { show: false },
                                   legend: { show: false },
                                   grid: {
                                     color: '#cdd6df',
                                     borderWidth: 2,
                                     backgroundColor: '#fff',
                                     hoverable: true,
                                     clickable: true,
                                     autoHighlight: false
                                   }
                                 });
      // Reset $scope.seriesList with lines.show = false
      $scope.seriesList.forEach(function(series) {
        series.flotSeries.points.show = series.visible;
        series.flotSeries.lines.show = false;
      });

      $("#overview-plot").bind("plotselected", function (event, ranges) {
        deselectDataPoint();
        hideTooltip();

        $.each($scope.plot.getXAxes(), function(_, axis) {
          var opts = axis.options;
          opts.min = ranges.xaxis.from;
          opts.max = ranges.xaxis.to;
        });
        $.each($scope.plot.getYAxes(), function(_, axis) {
          var opts = axis.options;
          opts.min = ranges.yaxis.from;
          opts.max = ranges.yaxis.to;
        });
        $scope.zoom = {'x': [ranges.xaxis.from, ranges.xaxis.to], 'y': [ranges.yaxis.from, ranges.yaxis.to]};

        $scope.plot.setupGrid();
        $scope.plot.draw();
        updateURL();
      });
    }

    function zoomGraph() {
      // If either x or y exists then there is zoom set in the variable
      if ($scope.zoom['x']) {
        if (_.find($scope.seriesList, function(series) { return series.visible; })) {  
          $.each($scope.plot.getXAxes(), function(_, axis) {
            var opts = axis.options;
            opts.min = $scope.zoom['x'][0];
            opts.max = $scope.zoom['x'][1];
          });
          $.each($scope.plot.getYAxes(), function(_, axis) {
            var opts = axis.options;
            opts.min = $scope.zoom['y'][0];
            opts.max = $scope.zoom['y'][1];
          });
          $scope.plot.setupGrid();
          $scope.overviewPlot.setSelection({
            xaxis: {
              from: $scope.zoom['x'][0],
              to: $scope.zoom['x'][1]
            },
            yaxis: {
              from: $scope.zoom['y'][0],
              to: $scope.zoom['y'][1]
            }
          });
          $scope.overviewPlot.draw();
          $scope.plot.draw();
        }
      }
    }

    function plotGraph() {
      // synchronize series visibility with flot, in case it's changed
      $scope.seriesList.forEach(function(series) {
        series.flotSeries.points.show = series.visible;
      });
      // plot the actual graph
      $scope.plot = $.plot($("#graph"),
                        $scope.seriesList.map(
                          function(series) { return series.flotSeries }),
                           {
                             xaxis: { mode: 'time' },
                             series: { shadowSize: 0 },
                             lines: { show: false },
                             points: { show: true },
                             legend: { show: false },
                             grid: {
                               color: '#cdd6df',
                               borderWidth: 2,
                               backgroundColor: '#fff',
                               hoverable: true,
                               clickable: true,
                               autoHighlight: false
                             }
                           });

      updateSelectedItem(null);
      highlightDataPoints();
      plotOverviewGraph();
      zoomGraph();

      function getDateStr(timestamp) {
        var date = new Date(parseInt(timestamp));
        return date.toUTCString();
      }

      function updateSelectedItem() {
        $scope.subtestResults = null;

        if (!$scope.selectedDataPoint) {
          hideTooltip();
          return;
        }

        // if we have an item with subtest signatures, fetch data for that and
        // display it
        var selectedSeriesIndex = _.findIndex(
          $scope.seriesList,
          function(s) {
            return s.projectName == $scope.selectedDataPoint.projectName &&
              s.signature == $scope.selectedDataPoint.signature;
          });
        var selectedSeries = $scope.seriesList[selectedSeriesIndex];
        if (selectedSeries.subtestSignatures) {
          var uri = thServiceDomain + '/api/project/' +
              selectedSeries.projectName + '/performance-data/0/' +
              'get_signature_properties/?';
          selectedSeries.subtestSignatures.forEach(function(signature) {
            uri += ('signatures=' + signature + '&');
          });
          var subtestResultsMap = {};
          $http.get(uri).then(function(response) {
            // first initialize the subtest result map
            var i = 0;
            selectedSeries.subtestSignatures.forEach(function(signature) {
              subtestResultsMap[signature] = { test: response.data[i].test,
                                               signature: signature,
                                               projectName: selectedSeries.projectName };
              i++;
            });
            var uri2 = thServiceDomain + '/api/project/' +
                selectedSeries.projectName + '/performance-data/0/' +
                'get_performance_data/?interval_seconds=' + $scope.myTimerange.value;
            selectedSeries.subtestSignatures.forEach(function(signature) {
              uri2 += ('&signatures=' + signature);
            });
            $http.get(uri2).then(function(response) {
              var prev = null;
              response.data.forEach(function(data) {
                var perfData = data.blob;
                var i = _.findIndex(perfData, function(v) {
                  return v.result_set_id == $scope.selectedDataPoint.resultSetId;
                });
                var v = perfData[i].mean;
                var v0 = i ? perfData[i-1].mean : v;
                var dv = v - v0;
                var dvp = v / v0 - 1;
                subtestResultsMap[data.series_signature] = jQuery.extend(
                  { value: v.toFixed(2),
                    dvalue: dv.toFixed(2),
                    dpercent: (100 * dvp).toFixed(1) },
                  subtestResultsMap[data.series_signature]);
              });
              $scope.subtestResults = Object.keys(subtestResultsMap).map(function(k) {
                return subtestResultsMap[k];
              }).sort(function(a,b) {
                return parseFloat(a.dpercent) < parseFloat(b.dpercent);
              });
            });
          });
        }
      }

      $("#graph").bind("plothover", function (event, pos, item) {

        // if examining an item, disable this behaviour
        if ($scope.selectedDataPoint)
          return;

        $('#graph').css({ cursor: item ? 'pointer' : 'default' });

        if (item && item.series.thSeries) {
          if (item.seriesIndex != $scope.prevSeriesIndex ||
              item.dataIndex != $scope.prevDataIndex) {
            var seriesDataPoint = getSeriesDataPoint(item);

            showTooltip(seriesDataPoint);
            $scope.prevSeriesIndex = item.seriesIndex;
            $scope.prevDataIndex = item.dataIndex;
          }
        } else {
          hideTooltip();
          $scope.prevSeriesIndex = null;
          $scope.prevDataIndex = null;
        }
      });

      $('#graph').bind('plotclick', function(e, pos, item) {
        if (item) {
          $scope.selectedDataPoint = getSeriesDataPoint(item);
          showTooltip($scope.selectedDataPoint);
          updateSelectedItem();
        } else {
          $scope.selectedDataPoint = null;
          hideTooltip();
          $scope.$digest();
        }

        highlightDataPoints();
      });
    }

    if (!$scope.myTimerange) {
      // 7 days is a sensible default
      $scope.myTimerange = $scope.timeranges[1];
    }

    $scope.timeRangeChanged = function() {
      $scope.zoom = {};
      deselectDataPoint();

      updateURL();
      // refetch and re-render all graph data
      $q.all($scope.seriesList.map(getSeriesData)).then(function() {
        plotGraph();
      });
    }

    $scope.repoName = $stateParams.projectId;

    function updateURL() {
      $state.transitionTo('graphs', { 'timerange': $scope.myTimerange.value,
                            'series':
                            $scope.seriesList.map(function(series) {
                              return encodeURIComponent(
                                JSON.stringify(
                                  { project: series.projectName,
                                    signature: series.signature,
                                    visible: series.visible})); }),
                            'highlightedRevision': $scope.highlightedRevision,
                            'zoom': JSON.stringify($scope.zoom)},
                {location: true, inherit: true, relative: $state.$current,
                 notify: false});
    }

    function getSeriesData(series) {
      return $http.get(thServiceDomain + '/api/project/' +
                       series.projectName +
                       '/performance-data/0/get_performance_data/' +
                       '?interval_seconds=' + $scope.myTimerange.value +
                       '&signatures=' + series.signature).then(
                         function(response) {
                           var flotSeries = {
                             lines: { show: false },
                             points: { show: series.visible },
                             color: series.color,
                             label: series.projectName + " " + series.name,
                             data: [],
                             resultSetData: [],
                             thSeries: jQuery.extend({}, series)
                           }
                           response.data[0].blob.forEach(function(dataPoint) {
                             var mean = dataPoint.mean;
                             if (mean === undefined)
                               mean = dataPoint.geomean;

                             flotSeries.data.push([
                               new Date(dataPoint.push_timestamp*1000),
                               mean]);
                             flotSeries.resultSetData.push(
                               dataPoint.result_set_id);
                           });
                           flotSeries.data.sort(function(a,b) {
                             return a[0] < b[0]; });
                           series.flotSeries = flotSeries;
                         });
    }

    $scope.addSeriesList = function(partialSeriesList) {
      var propsHash = {}
      return $q.all(partialSeriesList.map(
        function(partialSeries) {
          return $http.get(thServiceDomain + '/api/project/' +
                           partialSeries.project + '/performance-data/0/' +
                           'get_signature_properties/?signatures=' +
                           partialSeries.signature).then(function(response) {
                             var data = response.data;
                             if (!propsHash[partialSeries.project]) {
                               propsHash[partialSeries.project] = {};
                             }
                             propsHash[partialSeries.project][partialSeries.signature] = data[0];
                           });
        })).then(function() {
          // create a new seriesList in the correct order
          partialSeriesList.forEach(function(partialSeries) {
            var seriesSummary = getSeriesSummary(
              partialSeries.signature,
              propsHash[partialSeries.project][partialSeries.signature],
              optionCollectionMap);
            seriesSummary.projectName = partialSeries.project;
            seriesSummary.visible = partialSeries.visible;
            seriesSummary.color = availableColors.pop();
            seriesSummary.highlighted = partialSeries.highlighted;

            $scope.seriesList.push(seriesSummary);
          });
          $q.all($scope.seriesList.map(getSeriesData)).then(function() {
            $scope.highlightRevision();
            plotGraph();
            if ($scope.selectedDataPoint) {
              showTooltip($scope.selectedDataPoint);
            }
          });
        });
    };

    $scope.removeSeries = function(projectName, signature) {
      var newSeriesList = [];
      $scope.seriesList.forEach(function(series) {
        if (series.signature !== signature ||
            series.projectName !== projectName) {
          newSeriesList.push(series);
        } else {
          // add the color back to the list of available colors
          availableColors.push(series.color);

          // deselect datapoint if no longer valid
          if ($scope.selectedDataPoint &&
              $scope.selectedDataPoint.signature === signature &&
              $scope.selectedDataPoint.projectName === projectName) {
            $scope.selectedDataPoint = null;
          }
        }
      });
      $scope.seriesList = newSeriesList;

      if ($scope.seriesList.length == 0) {
        $scope.resetHighlight();
        $scope.zoom = {};
      }
      $scope.highlightRevision();
      updateURL();
      plotGraph();
      if ($scope.selectedDataPoint) {
        showTooltip($scope.selectedDataPoint);
      }
    };

    $scope.showHideSeries = function(signature) {
      updateURL();
      plotGraph();
      $scope.highlightRevision();
    }

    $scope.resetHighlight = function() {
      $scope.seriesList.forEach(function(series) {
        series.highlighted = [];
      });
      $scope.highlightedRevision = '';
      $scope.revisionToHighlight = "";
      $scope.resetHighlightButton = false;
      updateURL();
      plotGraph();
    }

    $scope.addHighlightedRevision = function() {
      var rev = $scope.revisionToHighlight;
      if (rev.length == 12) {
        $scope.highlightedRevision = rev;
        $scope.highlightRevision();
      } else if (rev.length == 0) {
        $scope.resetHighlight();
      } else {
        $scope.plot.unhighlight();
      }
    }

    $scope.highlightRevision = function() {
      var rev = $scope.highlightedRevision;
      if (rev.length == 12) {
        $q.all($scope.seriesList.map(function(series, i) {
          if (series.visible) {
           return $http.get(thServiceDomain + "/api/project/" + series.projectName +
             "/resultset/?format=json&revision=" + rev + "&with_jobs=false").then(
            function(response) {
              if (response.data.results.length > 0) {
                var result_set_id = response.data.results[0].id;
                var j = series.flotSeries.resultSetData.indexOf(result_set_id);
                var seriesToaddHighlight = _.find($scope.seriesList, function(sr) { return sr.signature == series.signature });
                seriesToaddHighlight.highlighted = [j, rev];
              }
            });
          }
          return null;
        })).then(function() {
          updateURL();
          plotGraph();
        });
      }
    }

    $scope.addSeries = function(project, signature) {
      $scope.addSeriesList([{ project: project, signature: signature,
                              visible: true }]);
      updateURL();
    };

    var optionCollectionMap = {};

    $http.get(thServiceDomain + '/api/optioncollectionhash').then(
      function(response) {
        response.data.forEach(function(dict) {
          optionCollectionMap[dict.option_collection_hash] =
            dict.options.map(function(option) {
              return option.name; }).join(" ");
        });
      }).then(function() {
        if ($stateParams.series) {
          $scope.seriesList = [];
          if (_.isString($stateParams.series)) {
            $stateParams.series = [$stateParams.series];
          }
          if ($stateParams.highlightedRevision) {
            $scope.highlightedRevision = $stateParams.highlightedRevision;
          } else {
            $scope.highlightedRevision = '';
          }

          if ($stateParams.zoom) {
            $scope.zoom = JSON.parse($stateParams.zoom);
          } else {
            $scope.zoom = {};
          }
          // we only store the signature + project name in the url, we need to
          // fetch everything else from the server
          var partialSeriesList = $stateParams.series.map(function(encodedSeries) {
            return JSON.parse(decodeURIComponent(encodedSeries));
          });
          $scope.addSeriesList(partialSeriesList);
        } else {
          $scope.seriesList = [];
        }

        $http.get(thServiceDomain + '/api/repository/').then(function(response) {
          $scope.projects = response.data;

          $scope.addTestData = function() {
            var defaultProjectName, defaultPlatform;
            if ($scope.seriesList.length > 0) {
              var lastSeries = $scope.seriesList.slice(-1)[0];
              defaultProjectName = lastSeries.projectName;
              defaultPlatform = lastSeries.platform;
            }

            var modalInstance = $modal.open({
              templateUrl: 'partials/perf/testdatachooser.html',
              controller: 'TestChooserCtrl',
              resolve: {
                projects: function() {
                  return $scope.projects;
                },
                optionCollectionMap: function() {
                  return optionCollectionMap;
                },
                timeRange: function() {
                  return $scope.myTimerange.value;
                },
                defaultProjectName: function() { return defaultProjectName; },
                defaultPlatform: function() { return defaultPlatform; }
              }
            });

            modalInstance.opened.then(function () {
              window.setTimeout(function () { modalInstance.updateTestInput(); }, 0);
            });

            modalInstance.result.then(function(series) {
              series.highlighted = [];
              series.visible = true;
              series.color = availableColors.pop();

              $scope.seriesList.push(series);
              if( !$scope.highlightedRevision ) {
                $scope.highlightedRevision = '';
              }
              if (!$scope.zoom) {
                $scope.zoom = {};
              }
              updateURL();
              getSeriesData(series).then(function() {
                plotGraph();
                $scope.highlightRevision();
              });
            });
          };
        });
      });
  }]);

perf.controller('TestChooserCtrl', function($scope, $modalInstance, $http,
                                            projects, optionCollectionMap,
                                            timeRange, thServiceDomain,
                                            getSeriesSummary, defaultProjectName,
                                            defaultPlatform) {
  $scope.timeRange = timeRange;
  $scope.projects = projects;
  if (defaultProjectName) {
    $scope.selectedProject = _.findWhere(projects, {name: defaultProjectName});
  } else {
    $scope.selectedProject = projects[0];
  }
  $scope.loadingTestData = false;

  var testInputCreated = false;

  $scope.addTestData = function () {
    var series = _.clone($scope.selectedSeries);
    series.projectName = $scope.selectedProject.name;
    $modalInstance.close(series);
  };

  $scope.cancel = function () {
    $modalInstance.dismiss('cancel');
  };

  $scope.updateTestInput = function() {
    $scope.addTestDataDisabled = true;
    $scope.loadingTestData = true;
    $scope.platformList = [];

    $http.get(thServiceDomain + '/api/project/' + $scope.selectedProject.name +
              '/performance-data/0/get_performance_series_summary/?interval=' +
              $scope.timeRange).then(
                function(response) {
                  var data = response.data;
                  var seriesList = [];
                  Object.keys(data).forEach(function(signature) {
                    var seriesSummary = getSeriesSummary(signature,
                                                         data[signature],
                                                         optionCollectionMap);

                    var platform = seriesSummary.platform;
                    if ($scope.platformList.indexOf(platform) === -1) {
                      $scope.platformList.push(platform);
                    }

                    seriesList.push(seriesSummary);
                  });
                  $scope.platformList.sort();
                  $scope.selectedPlatform = defaultPlatform ||
                    $scope.platformList[0];

                  $scope.updateTestSelector = function() {
                    var filteredSeriesList = seriesList.filter(
                      function(series) {
                        return (series.platform === $scope.selectedPlatform);
                      }).sort(function(a, b) { return a.name > b.name; });

                    var signatures = new Bloodhound({
                      datumTokenizer: Bloodhound.tokenizers.obj.whitespace('name'),
                      queryTokenizer: Bloodhound.tokenizers.whitespace,
                      limit: 100,
                      local: filteredSeriesList
                    });

                    // kicks off the loading/processing of `local` and `prefetch`
                    signatures.initialize();

                    if (testInputCreated) {
                      $('.typeahead').typeahead('destroy');
                    }

                    $('.typeahead').typeahead(null, {
                      name: 'signatures',
                      displayKey: 'name',
                      source: signatures.ttAdapter(),
                      limit: 100
                    }).on('typeahead:selected', function(obj, datum) {
                      $scope.selectedSeries = datum;
                      $scope.addTestDataDisabled = false;
                    });
                    testInputCreated = true;
                  }
                  $scope.updateTestSelector();

                  $scope.loadingTestData = false;
                });
  };

  $modalInstance.updateTestInput = $scope.updateTestInput;
});

perf.config(function($stateProvider, $urlRouterProvider) {
  $urlRouterProvider.deferIntercept(); // so we don't reload on url change

  $stateProvider.state('graphs', {
    templateUrl: 'partials/perf/perfctrl.html',
    url: '/graphs?timerange&series&highlightedRevision&zoom',
    controller: 'PerfCtrl'
  });

  $urlRouterProvider.otherwise('/graphs');
})
  // define the interception
  .run(function ($rootScope, $urlRouter, $location, $state) {
    $rootScope.$on('$locationChangeSuccess', function(e, newUrl, oldUrl) {
      // Prevent $urlRouter's default handler from firing
      e.preventDefault();
      if ($state.current.name !== 'graphs') {
        // here for first time, synchronize
        $urlRouter.sync();
      }
    });

    // Configures $urlRouter's listener *after* custom listener
    $urlRouter.listen();
  })


