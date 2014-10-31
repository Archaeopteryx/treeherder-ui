/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, you can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

treeherder.factory('treeStatus', [
    '$http', '$q',
    function($http, $q) {

    var urlBase = "https://treestatus.mozilla.org/";

    var getTreeStatusName = function(name) {
        // the thunderbird names in treestatus.mozilla.org don't match what
        // we use, so translate them.  pretty hacky, yes...
        // TODO: Move these to the repository fixture in the service.
        if (name.indexOf("comm-") >= 0 && name !== "try-comm-central") {
            return name + "-thunderbird";
        }
        return name;
    };

    var get = function(repoName) {
        var url = urlBase + getTreeStatusName(repoName);

        return $http.get(url, {params: {format: "json"}});
    };

    return {
        get: get,
        getTreeStatusName: getTreeStatusName,
    };
}]);

