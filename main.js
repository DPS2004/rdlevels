const Vue = require('vue');
const _ = require('lodash');
const ClipboardJS = require('clipboard');
const moment = require('moment');
const axios = require('axios');
const convert = require('./converter.js');
const createDOMPurify = require('dompurify');
const DOMPurify = createDOMPurify(window);
const AsyncComputed = require('vue-async-computed');
const work = require('webworkify')
const queryString = require('query-string');

const preprocess = require('./rdlevels_preprocess.js');

Vue.use(AsyncComputed);

const API_URL='https://script.google.com/macros/s/AKfycbzm3I9ENulE7uOmze53cyDuj7Igi7fmGiQ6w045fCRxs_sK3D4/exec';

var app = new Vue({
    el: '#app',
    components: {
      'pagination': require('./pagination.js')
    },
    data: {
      target: [],
      search_results: [],
      state: 'LOADING', // initial state
      error: null,
      limit: 15,
      limit_options: [
        { text: '6', value: 6},
        { text: '8', value: 8},
        { text: '15', value: 15 },
        { text: '24', value: 24 },
        { text: '48', value: 48 },
        { text: '72', value: 72 },
        { text: 'All', value: 9999 },
      ],
      i_currentPage: 0,
      sort_by: 'last_updated',
      sort_direction: 'ascending',
      display_type: 'cards',
      order_texts: {
        'score': {
          'ascending': 'most relevant',
          'descending': 'least relevant'
        },
        'last_updated': {
          'ascending': 'newest',
          'descending': 'oldest'
        },
        'song':{
          'ascending': 'a to z',
          'descending': 'z to a'
        },
        'author':{
          'ascending': 'a to z',
          'descending': 'z to a'
        },
        'difficulty': {
          'ascending': 'easiest',
          'descending': 'hardest'
        },
        'sampler': {
          'ascending' : '!',
          'descending' : '!!'
        }
      },
      trayOpen: false,
      searchQuery: '',
      sortState: "search",
      showAutoImportLinks: false,
      params: {}
    }, 
    computed: {
      truncated: function() {
        let sorted = this.sorted(this.search_results);
        return _.chunk(this.search_results, this.limit)[this.currentPage];
      },
      numberOfPages: function() {
        return _.chunk(this.search_results, this.limit).length;
      },
      currentPage: {
        get: function() {
          return _.clamp(this.i_currentPage, 0, this.numberOfPages-1);
        },
        set: function(newValue) {
          this.i_currentPage = _.clamp(newValue, 0, this.numberOfPages-1);
        }
      },
    },
    watch: {
      searchQuery: function() {
        let vm = this;
        console.log(this.searchQuery);
        this.debouncedFireSearchQuery();
        this.debouncedFireSearchQuery.cancel();
      },
      sortState: function() {
        if (this.sortState == 'relevance') {
          this.sort_by = 'score';
          this.sort_direction = 'ascending';
        } else if (this.sortState == 'sampler') {
          this.sort_by = 'sampler';
          this.sort_direction = 'ascending';
        } else if (this.sort_by === 'score') {
            this.sort_by = 'last_updated';
            this.sort_direction = 'ascending';  
        }
      }
    },
    methods: {
      fireSearchQuery: function() {
        this.worker.postMessage(['search', this.target, this.searchQuery]);
      },
      fireSamplerQuery: function() {
        this.worker.postMessage(['setrandom', _.random(20000)]);
      },
      searchCallback: function(e) {
        // callback from setrandom instead of search?
        if (e.data[0] === 'setrandom') {
          this.searchQuery = "*sampler";
        }
        else {
          this.search_results = e.data[1];
          this.sortState = e.data[0];
          this.currentPage = 0;
        }
      },
      sorted: function(data) {
        let reverse = (func) => {
          let inner = (a, b) => {
            return func(b, a);
          }
          return inner;
        };
        let sorting_functions = {
          'score': (a, b) => {
            return a.score < b.score ? -1 : 1;
          },
          'last_updated': (a, b) => {
            return (moment(a.last_updated) > moment(b.last_updated) ? -1 : 1);
          },
          'song': (a, b) => {
            return a.song.localeCompare(b.song);
          },
          'difficulty': (a, b) => {
            let difficultyMap = {
              'Easy' : 0,
              'Medium' : 1,
              'Tough' : 2,
              'VeryTough' : 3
            };
            return difficultyMap[a.difficulty] < difficultyMap[b.difficulty] ? -1 : 1;
          },
          'author': (a, b) => {
            return a.author.localeCompare(b.author);
          },
          'sampler': _.constant(0)
        };
        let sort_func = sorting_functions[this.sort_by];
        if (this.sort_direction === 'descending') {
          sort_func = reverse(sort_func);
        }
        data.sort(sort_func);
        return data;
      },
      switchPage: function(pageNo) {
        this.currentPage = pageNo;
      },
      switchType: function() {
        if (this.display_type === 'cards') {
          this.display_type = 'list';
        } else {
          this.display_type = 'cards';
        }
      },
      switchDirection: function() {
        if (this.sort_direction === 'ascending') {
          this.sort_direction = 'descending';
        } else {
          this.sort_direction = 'ascending';
        }
      },
      convertToHtml : function(text) {
        let proposedHtml = convert(text);
        return DOMPurify.sanitize(proposedHtml);
      },
      getBPMText : function(min_bpm, max_bpm) {
        if (min_bpm === max_bpm) {
          return max_bpm;
        }
        return `${min_bpm}-${max_bpm}`
      },
      getDifficultyText : function(diff) {
        if (diff === 'VeryTough') {
          return 'Very Tough';
        }
        return diff;
      },
      getAutoimportLink : function(url) {
        return 'rhythmdr://' + url
      },
      addDifficultyToSearch : function(diff) {
        let text = this.getDifficultyText(diff);
        this.searchQuery = `diff=${_.lowerCase(text)} ${this.searchQuery}`
      },
      addTagToSearch : function (tag) {
        this.searchQuery = `[${tag}] ${this.searchQuery}`
      },
      addToSearch : function (text) {
        this.searchQuery = `${text} ${this.searchQuery}`
      },
      getSeperator: function (i, total) {
        if (i === total - 2) {
          if (total > 2) {
            return ", and ";
          }
          return " and ";
        }
        if (i < total - 2) {
          return ", ";
        }
        return '';
      },
      niceDateFormatted: function(str) {
        let m = moment(str);
        return m.format("MMMM Do YYYY");
      },
      playerFormatted: function(p1, p2) {
        if (p1 && p2) {
          return 'both modes';
        }
        if (p1) {
          return '1p only';
        }
        return '2p only';
      },
      listViewDescription: function(level) {
        let descr = level.description;
        if (level.seizure_warning) {
          descr = '⚠️ ' + descr;
        }
        return this.convertToHtml(descr);
      }
    },
    mounted: function () {
        axios.get(API_URL)
        .then( (data) => {
            // insert data and change the state
            console.log(data.data);
            this.target = preprocess(data.data);
            this.search_results = this.target;
            this.startIndex = 0;
            this.state = "LOADED";
            this.params = queryString.parse(location.search);
            console.log(this.params);
            return this.$nextTick()
        })
        .then( () => {
          new ClipboardJS('.copy-link');
        })
        .catch( (err) => {
            // change the state
            this.state = "ERROR";
            this.error = err;
        });
    },
    created: function () {
      this.worker = work(require('./search.js'));
      this.worker.onmessage = this.searchCallback;
      this.debouncedFireSearchQuery = _.throttle(this.fireSearchQuery, 100);
    }
  })

  window.app = app;