'use strict';

var React = require('react');
var ReactDOM = require('react-dom');
var QuillMixin = require('./mixin');
var find = require('lodash/find');
var some = require('lodash/some');
var isEqual = require('lodash/isEqual');
var T = React.PropTypes;

var QuillComponent = React.createClass({

	displayName: 'Quill',

	mixins: [ QuillMixin ],

	propTypes: {
		id: T.string,
		className: T.string,
		theme: T.string,
		style: T.object,
		readOnly: T.bool,
		value: T.string,
		defaultValue: T.string,
		placeholder: T.string,
		bounds: T.oneOfType([T.string, T.element]),
		onKeyPress: T.func,
		onKeyDown: T.func,
		onKeyUp: T.func,
		onChange: T.func,
		onChangeSelection: T.func,

		modules: function(props) {
			var isNotObject = T.object.apply(this, arguments);
			if (isNotObject) return isNotObject;

			if (
				props.modules && 
				props.modules.toolbar &&
				props.modules.toolbar[0] &&
				props.modules.toolbar[0].type
			) return new Error(
				'Since v1.0.0, React Quill will not create a custom toolbar for you ' +
				'anymore. Create a toolbar explictly, or let Quill create one. ' +
				'See: https://github.com/zenoamaro/react-quill#upgrading-to-react-quill-v100'
			);
		},

		toolbar: function(props) {
			if ('toolbar' in props) return new Error(
				'The `toolbar` prop has been deprecated. Use `modules.toolbar` instead. ' +
				'See: https://github.com/zenoamaro/react-quill#upgrading-to-react-quill-v100'
			);
		},

		formats: function(props) {
			var isNotArrayOfString = T.arrayOf(T.string).apply(this, arguments);

			if (isNotArrayOfString) return new Error(
				'You cannot specify custom `formats` anymore. Use Parchment instead.  ' +
				'See: https://github.com/zenoamaro/react-quill#upgrading-to-react-quill-v100.'
			);
		},

		styles: function(props) {
			if ('styles' in props) return new Error(
				'The `styles` prop has been deprecated. Use custom stylesheets instead. ' +
				'See: https://github.com/zenoamaro/react-quill#upgrading-to-react-quill-v100.'
			);
		},

		pollInterval: function(props) {
			if ('pollInterval' in props) return new Error(
				'The `pollInterval` property does not have any effect anymore. ' +
				'You can safely remove it from your props.' +
				'See: https://github.com/zenoamaro/react-quill#upgrading-to-react-quill-v100.'
			);
		},

		children: function(props) {
			// Validate that the editor has only one child element and it is not a <textarea>
			var isNotASingleElement = React.PropTypes.element.apply(this, arguments);
			if (isNotASingleElement) return new Error(
				'The Quill editing area can only be composed of a single React element.'
			);

			if (React.Children.count(props.children)) {
				var child = React.Children.only(props.children);
				if (child.type === 'textarea') return new Error(
					'Quill does not support editing on a <textarea>. Use a <div> instead.'
				);
			}
		}
	},
		
	/*
	Changing one of these props should cause a full re-render.
	*/
	dirtyProps: [
		'modules',
		'formats',
		'bounds',
		'theme',
		'children',
	],

	/*
	Changing one of these props should cause a regular update.
	*/
	cleanProps: [
		'id',
		'className',
		'style',
		'placeholder',
		'onKeyPress',
		'onKeyDown',
		'onKeyUp',
		'onChange',
		'onChangeSelection',
	],

	getDefaultProps: function() {
		return {
			theme: 'snow',
			modules: {},
		};
	},

	/*
	We consider the component to be controlled if `value` is being sent in props.
	*/
	isControlled: function() {
		return 'value' in this.props;
	},

	getInitialState: function() {
		return {
			generation: 0,
			value: this.isControlled()
				? this.props.value
				: this.props.defaultValue
		};
	},

	componentWillReceiveProps: function(nextProps, nextState) {
		// If we need to regenerate the component, we can avoid a detailed
		// in-place update step, and just let everything rerender.
		if (this.shouldComponentRegenerate(nextProps, nextState)) {
			return this.regenerate();
		}

		var editor = this.editor;

		// If the component is unmounted and mounted too quickly
		// an error is thrown in setEditorContents since editor is
		// still undefined. Must check if editor is undefined
		// before performing this call.
		if (!editor) return;
		
		// Update only if we've been passed a new `value`.
		// This leaves components using `defaultValue` alone.
		if ('value' in nextProps) {
			// NOTE: Seeing that Quill is missing a way to prevent
			//       edits, we have to settle for a hybrid between
			//       controlled and uncontrolled mode. We can't prevent
			//       the change, but we'll still override content
			//       whenever `value` differs from current state.
			if (nextProps.value !== this.getEditorContents()) {
				this.setEditorContents(editor, nextProps.value);
			}
		}
		
		// We can update readOnly state in-place.
		if ('readOnly' in nextProps) {
			if (nextProps.readOnly !== this.props.readOnly) {
				this.setEditorReadOnly(editor, nextProps.readOnly);
			}
		}
	},

	componentDidMount: function() {
		this.editor = this.createEditor(
			this.getEditingArea(),
			this.getEditorConfig()
		);
		if (this.quillDelta) {
			this.editor.setContents(this.quillDelta);
			this.editor.setSelection(this.quillSelection);		
			this.editor.focus();
			return;
		}
		if (this.state.value) {
			this.setEditorContents(this.editor, this.state.value);
			return;
		}
	},

	componentWillUnmount: function() {
		var editor; if ((editor = this.getEditor())) {
			this.unhookEditor(editor);
			this.editor = null;
		}
	},

	shouldComponentUpdate: function(nextProps, nextState) {
		var self = this;

		// If the component has been regenerated, we already know we should update.
		if (this.state.generation !== nextState.generation) {
			return true;
		}
		
		// Compare props that require React updating the DOM.
		return some(this.cleanProps, function(prop) {
			// Note that `isEqual` compares deeply, making it safe to perform
			// non-immutable updates, at the cost of performance.
			return !isEqual(nextProps[prop], self.props[prop]);
		});
	},

	shouldComponentRegenerate: function(nextProps, nextState) {
		var self = this;
		// Whenever a `dirtyProp` changes, the editor needs reinstantiation.
		return some(this.dirtyProps, function(prop) {
			// Note that `isEqual` compares deeply, making it safe to perform
			// non-immutable updates, at the cost of performance.
			return !isEqual(nextProps[prop], self.props[prop]);
		});
	},

	/*
	If we could not update settings from the new props in-place, we have to tear
	down everything and re-render from scratch.
	*/
	componentWillUpdate: function(nextProps, nextState) {
		if (this.state.generation !== nextState.generation) {
			this.componentWillUnmount();
		}
	},

	componentDidUpdate: function(prevProps, prevState) {
		if (this.state.generation !== prevState.generation) {
			this.componentDidMount();
		}
	},

	getEditorConfig: function() {
		return {
			bounds:       this.props.bounds,
			formats:      this.props.formats,
			modules:      this.props.modules,
			placeholder:  this.props.placeholder,
			readOnly:     this.props.readOnly,
			theme:        this.props.theme,
		};
	},

	getEditor: function() {
		return this.editor;
	},

	getEditingArea: function () {
		return ReactDOM.findDOMNode(this.editingArea);
	},

	getEditorContents: function() {
		return this.state.value;
	},

	getEditorSelection: function() {
		return this.state.selection;
	},

	/*
	Regenerating the editor will cause the whole tree, including the container,
	to be cleaned up and re-rendered from scratch.
	*/
	regenerate: function() {
		this.quillDelta = this.editor.getContents();
		this.quillSelection = this.editor.getSelection();
		this.setState({
			generation: this.state.generation + 1,
		});
	},

	/*
	Renders an editor area, unless it has been provided one to clone.
	*/
	renderEditingArea: function() {
		var self = this;
		var children = this.props.children;

		var properties = {
			key: this.state.generation,
			ref: function(element) { self.editingArea = element },
		};

		var customElement = React.Children.count(children)
			? React.Children.only(children)
			: null;

		var editingArea = customElement
			? React.cloneElement(customElement, properties)
			: React.DOM.div(properties);

		return editingArea;
	},

	render: function() {
		return React.DOM.div({
			id: this.props.id,
			style: this.props.style,
			key: this.state.generation,
			className: ['quill'].concat(this.props.className).join(' '),
			onKeyPress: this.props.onKeyPress,
			onKeyDown: this.props.onKeyDown,
			onKeyUp: this.props.onKeyUp },
			this.renderEditingArea()
		);
	},

	onEditorChangeText: function(value, delta, source, editor) {
		if (value !== this.getEditorContents()) {
			this.setState({ value: value });
			if (this.props.onChange) {
				this.props.onChange(value, delta, source, editor);
			}
		}
	},

	onEditorChangeSelection: function(range, source, editor) {
		var s = this.getEditorSelection() || {};
		var r = range || {};
		if (r.length !== s.length || r.index !== s.index) {
			this.setState({ selection: range });
			if (this.props.onChangeSelection) {
				this.props.onChangeSelection(range, source, editor);
			}
		}
	},

	focus: function() {
		this.editor.focus();
	},

	blur: function() {
		this.setEditorSelection(this.editor, null);
	}

});

module.exports = QuillComponent;
