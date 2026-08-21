import ast
import bdb
import builtins
import io
import json
import keyword
import os
import sys
import tokenize


MAX_STEPS = 1000
MAX_COLLECTION_ITEMS = 20
MAX_OUTPUT_BYTES = 64 * 1024
IGNORED_NAMES = {
    "__annotations__",
    "__builtins__",
    "__cached__",
    "__doc__",
    "__file__",
    "__loader__",
    "__name__",
    "__package__",
    "__spec__",
    "input",
    "print",
}
NO_RETURN = object()


def encode_value(value, depth=0):
    if depth > 3:
        return f"<{type(value).__name__}>"
    if value is None or isinstance(value, (bool, int, float, str)):
        if isinstance(value, str) and len(value) > 300:
            return value[:297] + "..."
        return value
    if isinstance(value, (list, tuple)):
        return [encode_value(item, depth + 1) for item in value[:MAX_COLLECTION_ITEMS]]
    if isinstance(value, dict):
        return {
            str(key): encode_value(item, depth + 1)
            for key, item in list(value.items())[:MAX_COLLECTION_ITEMS]
        }
    if isinstance(value, set):
        ordered = sorted(value, key=lambda item: repr(item))
        return [encode_value(item, depth + 1) for item in ordered[:MAX_COLLECTION_ITEMS]]
    if callable(value):
        return f"<function {getattr(value, '__name__', type(value).__name__)}>"
    try:
        rendered = str(value)
        return rendered if len(rendered) <= 300 else rendered[:297] + "..."
    except Exception:
        return f"<{type(value).__name__}>"


def encode_state(value):
    if value is None or isinstance(value, (bool, int, float, str)):
        kind = "scalar"
        length = len(value) if isinstance(value, str) else None
    elif isinstance(value, list):
        kind, length = "list", len(value)
    elif isinstance(value, tuple):
        kind, length = "tuple", len(value)
    elif isinstance(value, dict):
        kind, length = "dict", len(value)
    elif isinstance(value, set):
        kind, length = "set", len(value)
    else:
        kind, length = "object", None

    encoded = encode_value(value)
    return {
        "kind": kind,
        "value": encoded,
        "length": length,
        "truncated_count": max((length or 0) - MAX_COLLECTION_ITEMS, 0),
    }


def is_visible_name(name):
    return name not in IGNORED_NAMES and not (name.startswith("__") and name != "__return__")


def visible_variables(values):
    return {name: encode_value(value) for name, value in values.items() if is_visible_name(name)}


def visible_states(values):
    return {name: encode_state(value) for name, value in values.items() if is_visible_name(name)}


def visible_global_variables(values):
    return {
        name: encode_value(value)
        for name, value in values.items()
        if name not in IGNORED_NAMES and not name.startswith("__") and not callable(value)
    }


def visible_global_states(values):
    return {
        name: encode_state(value)
        for name, value in values.items()
        if name not in IGNORED_NAMES and not name.startswith("__") and not callable(value)
    }


def diff_collection(before, after):
    if not before or not after or before.get("kind") != after.get("kind"):
        return []
    kind = before.get("kind")
    before_value = before.get("value")
    after_value = after.get("value")
    changes = []

    if kind in ("list", "tuple") and isinstance(before_value, list) and isinstance(after_value, list):
        for index in range(max(len(before_value), len(after_value))):
            previous = before_value[index] if index < len(before_value) else None
            current = after_value[index] if index < len(after_value) else None
            if index >= len(before_value):
                change_kind = "created"
            elif index >= len(after_value):
                change_kind = "deleted"
            elif previous != current:
                change_kind = "updated"
            else:
                continue
            changes.append({"key": index, "kind": change_kind, "before": previous, "after": current})
    elif kind == "dict" and isinstance(before_value, dict) and isinstance(after_value, dict):
        keys = list(dict.fromkeys([*before_value.keys(), *after_value.keys()]))
        for key in keys:
            if key not in before_value:
                change_kind = "created"
            elif key not in after_value:
                change_kind = "deleted"
            elif before_value[key] != after_value[key]:
                change_kind = "updated"
            else:
                continue
            changes.append({
                "key": key,
                "kind": change_kind,
                "before": before_value.get(key),
                "after": after_value.get(key),
            })
    elif kind == "set" and isinstance(before_value, list) and isinstance(after_value, list):
        for item in before_value:
            if item not in after_value:
                changes.append({"key": item, "kind": "deleted", "before": item, "after": None})
        for item in after_value:
            if item not in before_value:
                changes.append({"key": item, "kind": "created", "before": None, "after": item})
    return changes


def diff_states(before, after, scope, call_id=None):
    changes = []
    names = list(dict.fromkeys([*before.keys(), *after.keys()]))
    for name in names:
        previous = before.get(name)
        current = after.get(name)
        if previous == current:
            continue
        if previous is None:
            kind = "created"
        elif current is None:
            kind = "deleted"
        elif diff_collection(previous, current):
            kind = "mutated"
        else:
            kind = "updated"
        changes.append({
            "scope": scope,
            "call_id": call_id,
            "name": name,
            "kind": kind,
            "before": previous,
            "after": current,
            "items": diff_collection(previous, current),
        })
    return changes


class CallCollector(ast.NodeVisitor):
    def __init__(self, source):
        self.source = source
        self.calls = []

    @staticmethod
    def _name(node):
        if isinstance(node, ast.Name):
            return node.id
        if isinstance(node, ast.Attribute):
            return node.attr
        return ""

    def visit_Call(self, node):
        self.visit(node.func)
        for argument in node.args:
            self.visit(argument)
        for keyword in node.keywords:
            self.visit(keyword.value)

        arguments = []
        for argument in node.args:
            expression = ast.get_source_segment(self.source, argument) or ast.unparse(argument)
            arguments.append({"expression": expression, "keyword": None})
        for keyword in node.keywords:
            expression = ast.get_source_segment(self.source, keyword.value) or ast.unparse(keyword.value)
            arguments.append({"expression": expression, "keyword": keyword.arg})

        self.calls.append({
            "line": node.lineno,
            "column": node.col_offset,
            "end_column": getattr(node, "end_col_offset", node.col_offset),
            "func_name": self._name(node.func),
            "expression": ast.get_source_segment(self.source, node) or ast.unparse(node),
            "arguments": arguments,
        })


class CodeAnalyzer:
    def __init__(self, code):
        self.code = code
        self.code_lines = code.split("\n")
        self.blocks = []
        self.statements = {}
        self.call_sites = {}
        self.tokens_by_line = self._tokenize()
        try:
            self.tree = ast.parse(code)
        except SyntaxError:
            self.tree = None
            return

        self._mark_function_tokens()
        self._collect_statements()
        self._visit_blocks(self.tree, 0)
        collector = CallCollector(code)
        collector.visit(self.tree)
        for call in collector.calls:
            calls = self.call_sites.setdefault(call["line"], [])
            call["order"] = len(calls)
            calls.append(call)

    def _tokenize(self):
        tokens = {}
        try:
            for token in tokenize.generate_tokens(io.StringIO(self.code).readline):
                if token.type == tokenize.NAME:
                    if keyword.iskeyword(token.string):
                        kind = "keyword"
                    elif hasattr(builtins, token.string):
                        kind = "builtin"
                    else:
                        kind = "identifier"
                elif token.type == tokenize.STRING:
                    kind = "string"
                elif token.type == tokenize.NUMBER:
                    kind = "number"
                elif token.type == tokenize.COMMENT:
                    kind = "comment"
                elif token.type == tokenize.OP:
                    kind = "operator"
                else:
                    continue
                tokens.setdefault(token.start[0], []).append({
                    "name": token.string,
                    "start": token.start[1],
                    "end": token.end[1],
                    "kind": kind,
                })
        except (tokenize.TokenError, IndentationError):
            pass
        return tokens

    def _mark_function_tokens(self):
        function_positions = set()
        function_names = {
            node.name
            for node in ast.walk(self.tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                for token in self.tokens_by_line.get(node.lineno, []):
                    if token["name"] == node.name and token["start"] >= node.col_offset:
                        function_positions.add((node.lineno, token["start"], token["end"]))
                        break
            elif isinstance(node, ast.Call):
                function = node.func
                if isinstance(function, ast.Name) and function.id in function_names:
                    function_positions.add((function.lineno, function.col_offset, function.end_col_offset))
                elif isinstance(function, ast.Attribute) and function.attr in function_names:
                    start = function.end_col_offset - len(function.attr)
                    function_positions.add((function.end_lineno, start, function.end_col_offset))

        for line, line_tokens in self.tokens_by_line.items():
            for token in line_tokens:
                if (line, token["start"], token["end"]) in function_positions:
                    token["kind"] = "function"

    @staticmethod
    def _expression(node):
        try:
            return ast.unparse(node)
        except Exception:
            return ""

    def _source_line(self, line):
        return self.code_lines[line - 1].strip() if 0 < line <= len(self.code_lines) else ""

    def _collect_statements(self):
        for node in ast.walk(self.tree):
            if isinstance(node, ast.stmt):
                self.statements.setdefault(node.lineno, []).append(node)

    def _visit_blocks(self, node, depth):
        block = None
        if isinstance(node, ast.For):
            block = {
                "type": "for_loop",
                "label": "for",
                "name": "반복문",
                "expression": f"{self._expression(node.target)} in {self._expression(node.iter)}",
            }
        elif isinstance(node, ast.While):
            block = {
                "type": "while_loop",
                "label": "while",
                "name": "반복문",
                "expression": self._expression(node.test),
            }
        elif isinstance(node, ast.If):
            label = "elif" if self._source_line(node.lineno).startswith("elif ") else "if"
            block = {
                "type": "if_block",
                "label": label,
                "name": "조건문",
                "expression": self._expression(node.test),
            }
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            parameters = [argument.arg for argument in node.args.args]
            block = {
                "type": "function",
                "label": "def",
                "name": node.name,
                "expression": f"{node.name}({', '.join(parameters)})",
            }

        next_depth = depth
        if block is not None:
            body = getattr(node, "body", [])
            block.update({
                "start_line": node.lineno,
                "end_line": getattr(node, "end_lineno", node.lineno),
                "body_start": body[0].lineno if body else node.lineno,
                "body_end": getattr(body[-1], "end_lineno", node.lineno) if body else node.lineno,
                "depth": depth,
                "parent_blocks": [],
            })
            self.blocks.append(block)
            next_depth += 1

            if isinstance(node, ast.If) and node.orelse and not isinstance(node.orelse[0], ast.If):
                first_line = node.orelse[0].lineno
                header_line = max(node.lineno, first_line - 1)
                self.blocks.append({
                    "type": "else_block",
                    "label": "else",
                    "name": "조건문",
                    "expression": "",
                    "start_line": header_line,
                    "end_line": getattr(node.orelse[-1], "end_lineno", first_line),
                    "body_start": first_line,
                    "body_end": getattr(node.orelse[-1], "end_lineno", first_line),
                    "depth": next_depth,
                    "parent_blocks": [],
                })

        for child in ast.iter_child_nodes(node):
            self._visit_blocks(child, next_depth)

    def current_blocks(self, line):
        matches = [dict(block) for block in self.blocks if block["start_line"] <= line <= block["end_line"]]
        matches.sort(key=lambda block: (block["depth"], block["start_line"]))
        for index, block in enumerate(matches):
            block["parent_blocks"] = matches[:index]
        return matches

    def block_starting_at(self, line):
        matches = [block for block in self.blocks if block["start_line"] == line]
        return max(matches, key=lambda block: block["depth"], default=None)

    def statement_kind(self, line):
        source = self._source_line(line)
        if source.startswith("def "):
            return "function_def"
        if source.startswith(("if ", "elif ", "else:")):
            return "condition"
        if source.startswith(("for ", "while ")):
            return "loop"
        if source.startswith("break"):
            return "break"
        if source.startswith("continue"):
            return "continue"
        if source.startswith("return"):
            return "return"
        if source.startswith("print("):
            return "output"
        if source.startswith("raise "):
            return "raise"
        if source.startswith("del "):
            return "delete"

        nodes = self.statements.get(line, [])
        if any(isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)) for node in nodes):
            if "input(" in source:
                return "input"
            return "assignment"
        if any(isinstance(node, ast.Expr) and isinstance(node.value, ast.Call) for node in nodes):
            return "function_call"
        return "execution"

    def calls_for(self, line):
        return [dict(call) for call in self.call_sites.get(line, [])]


class TraceLimitExceeded(Exception):
    pass


class TraceOutput(io.TextIOBase):
    def __init__(self, tracer, capture=True):
        self.tracer = tracer
        self.capture = capture
        self.size = 0

    def writable(self):
        return True

    def write(self, value):
        if not isinstance(value, str):
            raise TypeError("write() argument must be str")
        encoded_size = len(value.encode("utf-8"))
        if self.size + encoded_size > MAX_OUTPUT_BYTES:
            self.tracer.truncated = True
            raise TraceLimitExceeded("출력이 64KiB 제한을 초과했습니다.")
        self.size += encoded_size
        if self.capture:
            self.tracer.output.append(value)
            self.tracer.console_output.append(value)
        return len(value)

    def flush(self):
        return None


class FrameTracer(bdb.Bdb):
    def __init__(self, code):
        super().__init__()
        self.code = code
        self.code_lines = code.split("\n")
        self.analyzer = CodeAnalyzer(code)
        self.output = []
        self.console_output = []
        self.steps = []
        self.call_tree = []
        self.frame_call_ids = {}
        self.next_call_id = 1
        self.pending = {}
        self.loop_counts = {}
        self.active_frame_id = None
        self.exception_frames = set()
        self.runtime_error_recorded = False
        self.truncated = False

    @staticmethod
    def _is_user_frame(frame):
        return frame.f_code.co_filename.endswith("user_code.py")

    def _ensure_capacity(self):
        if len(self.steps) >= MAX_STEPS:
            self.truncated = True
            raise TraceLimitExceeded(f"시각화 단계가 {MAX_STEPS}개를 초과했습니다.")

    @staticmethod
    def _frame_arguments(frame):
        code = frame.f_code
        positional_count = code.co_argcount
        keyword_count = code.co_kwonlyargcount
        argument_names = list(code.co_varnames[:positional_count + keyword_count])
        next_index = positional_count + keyword_count
        if code.co_flags & 0x04:
            argument_names.append(code.co_varnames[next_index])
            next_index += 1
        if code.co_flags & 0x08:
            argument_names.append(code.co_varnames[next_index])
        return {
            name: encode_value(frame.f_locals[name])
            for name in argument_names
            if name in frame.f_locals
        }

    def _parent_user_frame(self, frame):
        current = frame.f_back
        while current:
            if self._is_user_frame(current):
                return current
            current = current.f_back
        return None

    def _stack_frames(self, frame):
        frames = []
        current = frame
        while current:
            if self._is_user_frame(current):
                locals_values = visible_variables(current.f_locals)
                name = current.f_code.co_name
                if name == "<module>":
                    name = "Global frame"
                ordered = [variable for variable in current.f_code.co_varnames if variable in locals_values]
                ordered.extend(sorted(variable for variable in locals_values if variable not in ordered))
                frames.append({
                    "func_name": name,
                    "call_id": self.frame_call_ids.get(id(current)),
                    "encoded_locals": locals_values,
                    "local_states": visible_states(current.f_locals),
                    "ordered_varnames": ordered,
                    "line_number": current.f_lineno,
                })
            current = current.f_back
        return list(reversed(frames))

    @staticmethod
    def _legacy_operation(kind):
        return {
            "assignment": "assignment",
            "input": "assignment",
            "condition": "condition",
            "loop": "loop",
            "function_def": "function_def",
            "function_call": "function_call",
            "return": "return",
            "output": "output",
            "break": "loop_control",
            "continue": "loop_control",
            "delete": "assignment",
            "raise": "error",
        }.get(kind, "execution")

    @staticmethod
    def _description(kind):
        return {
            "assignment": "변수 값 변경",
            "input": "입력값 사용",
            "condition": "조건 확인",
            "loop": "반복문 확인",
            "function_def": "함수 정의",
            "function_call": "함수 호출",
            "return": "값 반환",
            "output": "값 출력",
            "break": "반복 중단",
            "continue": "다음 반복으로 이동",
            "delete": "값 삭제",
            "raise": "오류 발생",
        }.get(kind, "코드 실행")

    def _start_line(self, frame):
        self._ensure_capacity()
        line = frame.f_lineno
        kind = self.analyzer.statement_kind(line)
        local_values = visible_variables(frame.f_locals)
        global_values = visible_global_variables(frame.f_globals)
        local_states = visible_states(frame.f_locals)
        global_states = visible_global_states(frame.f_globals)
        is_module = frame.f_code.co_name == "<module>"
        call_id = self.frame_call_ids.get(id(frame))
        step_index = len(self.steps)
        self.steps.append({
            "line": line,
            "operation": self._legacy_operation(kind),
            "statement_kind": kind,
            "phase": "before",
            "variables": global_values if is_module else {**global_values, **local_values},
            "variables_state": global_states if is_module else {**global_states, **local_states},
            "output": "".join(self.output).rstrip("\n"),
            "output_delta": "",
            "console_output": "".join(self.console_output).rstrip("\n"),
            "console_delta": "",
            "description": self._description(kind),
            "func_name": "Global frame" if is_module else frame.f_code.co_name,
            "call_id": call_id,
            "stack_frames": self._stack_frames(frame),
            "globals_vars": global_values,
            "globals_state": global_states,
            "current_blocks": self.analyzer.current_blocks(line),
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_sites": self.analyzer.calls_for(line),
        })
        self.pending[id(frame)] = {
            "frame": frame,
            "step_index": step_index,
            "before_local": local_states,
            "before_global": global_states,
            "output_before": "".join(self.output),
            "console_before": "".join(self.console_output),
            "input_event": None,
            "used_call_orders": set(),
        }
        self.active_frame_id = id(frame)

    def finalize_remaining(self):
        for pending in list(self.pending.values()):
            self._finalize_pending(pending["frame"])

    def _finalize_pending(self, frame, next_line=None, return_value=NO_RETURN):
        pending = self.pending.pop(id(frame), None)
        if not pending:
            return
        base_step = self.steps[pending["step_index"]]
        append_after_step = pending["step_index"] != len(self.steps) - 1
        step = dict(base_step) if append_after_step else base_step
        local_values = visible_variables(frame.f_locals)
        local_states = visible_states(frame.f_locals)
        if return_value is not NO_RETURN:
            local_values["__return__"] = encode_value(return_value)
            local_states["__return__"] = encode_state(return_value)
        global_values = visible_global_variables(frame.f_globals)
        global_states = visible_global_states(frame.f_globals)
        is_module = frame.f_code.co_name == "<module>"
        call_id = self.frame_call_ids.get(id(frame))

        if is_module:
            changes = diff_states(pending["before_global"], global_states, "global", None)
        else:
            changes = diff_states(pending["before_local"], local_states, "local", call_id)
            changes.extend(diff_states(pending["before_global"], global_states, "global", None))

        output_after = "".join(self.output)
        output_before = pending["output_before"]
        output_delta = output_after[len(output_before):] if output_after.startswith(output_before) else output_after
        console_after = "".join(self.console_output)
        console_before = pending["console_before"]
        console_delta = console_after[len(console_before):] if console_after.startswith(console_before) else console_after
        step.update({
            "phase": "after",
            "variables": global_values if is_module else {**global_values, **local_values},
            "variables_state": global_states if is_module else {**global_states, **local_states},
            "output": output_after.rstrip("\n"),
            "output_delta": output_delta,
            "console_output": console_after.rstrip("\n"),
            "console_delta": console_delta,
            "stack_frames": self._stack_frames(frame),
            "globals_vars": global_values,
            "globals_state": global_states,
            "changes": changes,
            "input_event": pending["input_event"],
        })

        block = self.analyzer.block_starting_at(step["line"])
        control_state = None
        if block and block["type"] in ("if_block", "while_loop", "for_loop"):
            enters_body = next_line is not None and block["body_start"] <= next_line <= block["body_end"]
            if next_line is None and return_value is not NO_RETURN and block["body_start"] == step["line"]:
                enters_body = True
            if block["type"] == "if_block":
                control_state = {"kind": "condition", "result": enters_body}
                step["condition_result"] = enters_body
            else:
                loop_key = (call_id, step["line"])
                if enters_body:
                    self.loop_counts[loop_key] = self.loop_counts.get(loop_key, 0) + 1
                iteration = self.loop_counts.get(loop_key, 0)
                control_state = {
                    "kind": "loop",
                    "iteration": iteration,
                    "finished": not enters_body,
                }
                step["loop_iteration"] = iteration
                step["loop_finished"] = not enters_body

        if step["statement_kind"] == "break":
            control_state = {"kind": "loop_control", "action": "break"}
        elif step["statement_kind"] == "continue":
            control_state = {"kind": "loop_control", "action": "continue"}
        step["control_state"] = control_state

        if pending["input_event"]:
            value = pending["input_event"]["value"]
            step["description"] = f"입력값 {value!r} 사용"
        elif output_delta:
            step["description"] = "값 출력"
        elif changes:
            names = ", ".join(change["name"] for change in changes[:3])
            step["description"] = f"{names} 값 변경"

        if append_after_step:
            self._ensure_capacity()
            self.steps.append(step)

    def record_input(self, prompt, value):
        pending = self.pending.get(self.active_frame_id)
        if pending is not None:
            pending["input_event"] = {"prompt": prompt, "value": value}

    def _match_call_site(self, parent_frame, child_frame):
        if parent_frame is None:
            return None
        pending = self.pending.get(id(parent_frame))
        if not pending:
            return None
        parent_step = self.steps[pending["step_index"]]
        child_name = child_frame.f_code.co_name
        candidates = parent_step.get("call_sites", [])
        selected = None
        for candidate in candidates:
            if candidate.get("order") in pending["used_call_orders"]:
                continue
            if candidate.get("func_name") == child_name:
                selected = candidate
                break
        if selected is None:
            return None
        pending["used_call_orders"].add(selected["order"])

        child_arguments = self._frame_arguments(child_frame)
        positional_names = list(child_arguments.keys())
        positional_index = 0
        bindings = []
        for argument in selected.get("arguments", []):
            parameter = argument.get("keyword")
            if parameter is None:
                if positional_index >= len(positional_names):
                    continue
                parameter = positional_names[positional_index]
                positional_index += 1
            if parameter not in child_arguments:
                continue
            bindings.append({
                "expression": argument.get("expression", ""),
                "parameter": parameter,
                "value": child_arguments[parameter],
            })
        return {
            "line": selected["line"],
            "expression": selected["expression"],
            "order": selected["order"],
            "bindings": bindings,
        }

    def _append_call_step(self, frame, call_id, call_site):
        self._ensure_capacity()
        arguments = self._frame_arguments(frame)
        global_values = visible_global_variables(frame.f_globals)
        global_states = visible_global_states(frame.f_globals)
        self.steps.append({
            "line": frame.f_code.co_firstlineno,
            "operation": "function_call",
            "statement_kind": "function_call",
            "phase": "call",
            "variables": {**global_values, **visible_variables(frame.f_locals)},
            "variables_state": {**global_states, **visible_states(frame.f_locals)},
            "output": "".join(self.output).rstrip("\n"),
            "output_delta": "",
            "console_output": "".join(self.console_output).rstrip("\n"),
            "console_delta": "",
            "description": f"함수 '{frame.f_code.co_name}' 호출",
            "func_name": frame.f_code.co_name,
            "call_id": call_id,
            "stack_frames": self._stack_frames(frame),
            "globals_vars": global_values,
            "globals_state": global_states,
            "current_blocks": self.analyzer.current_blocks(frame.f_code.co_firstlineno),
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_site": call_site,
            "call_sites": [],
            "arguments": arguments,
        })

    def _append_return_step(self, frame, call_id, return_value):
        self._ensure_capacity()
        local_values = visible_variables(frame.f_locals)
        local_values["__return__"] = encode_value(return_value)
        local_states = visible_states(frame.f_locals)
        local_states["__return__"] = encode_state(return_value)
        global_values = visible_global_variables(frame.f_globals)
        global_states = visible_global_states(frame.f_globals)
        self.steps.append({
            "line": frame.f_lineno,
            "operation": "function_return",
            "statement_kind": "return",
            "phase": "return",
            "variables": {**global_values, **local_values},
            "variables_state": {**global_states, **local_states},
            "output": "".join(self.output).rstrip("\n"),
            "output_delta": "",
            "console_output": "".join(self.console_output).rstrip("\n"),
            "console_delta": "",
            "description": f"{frame.f_code.co_name} 함수가 {encode_value(return_value)!r} 반환",
            "func_name": frame.f_code.co_name,
            "call_id": call_id,
            "stack_frames": self._stack_frames(frame),
            "globals_vars": global_values,
            "globals_state": global_states,
            "current_blocks": self.analyzer.current_blocks(frame.f_lineno),
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_sites": [],
            "return_value": encode_value(return_value),
        })

    def _append_error_step(self, frame, error):
        if self.runtime_error_recorded:
            return
        self.runtime_error_recorded = True
        self._ensure_capacity()
        line = frame.f_lineno
        global_values = visible_global_variables(frame.f_globals)
        global_states = visible_global_states(frame.f_globals)
        self.steps.append({
            "line": line,
            "operation": "error",
            "statement_kind": "error",
            "phase": "error",
            "variables": {**global_values, **visible_variables(frame.f_locals)},
            "variables_state": {**global_states, **visible_states(frame.f_locals)},
            "output": "".join(self.output).rstrip("\n"),
            "output_delta": "",
            "console_output": "".join(self.console_output).rstrip("\n"),
            "console_delta": "",
            "description": f"실행 중 오류 발생: {type(error).__name__}: {error}",
            "func_name": frame.f_code.co_name,
            "call_id": self.frame_call_ids.get(id(frame)),
            "stack_frames": self._stack_frames(frame),
            "globals_vars": global_values,
            "globals_state": global_states,
            "current_blocks": self.analyzer.current_blocks(line),
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_sites": [],
        })

    def append_syntax_error(self, error):
        line = min(max(getattr(error, "lineno", 1) or 1, 1), max(len(self.code_lines), 1))
        self.steps.append({
            "line": line,
            "operation": "error",
            "statement_kind": "error",
            "phase": "error",
            "variables": {},
            "variables_state": {},
            "output": "",
            "output_delta": "",
            "console_output": "",
            "console_delta": "",
            "description": f"문법 오류: {error.msg}",
            "func_name": "Error",
            "call_id": None,
            "stack_frames": [],
            "globals_vars": {},
            "globals_state": {},
            "current_blocks": [],
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_sites": [],
        })

    def user_line(self, frame):
        if not self._is_user_frame(frame):
            return
        self._finalize_pending(frame, next_line=frame.f_lineno)
        self._start_line(frame)

    def user_call(self, frame, argument_list):
        if not self._is_user_frame(frame) or frame.f_code.co_name == "<module>":
            return
        call_id = self.next_call_id
        self.next_call_id += 1
        self.frame_call_ids[id(frame)] = call_id
        parent_frame = self._parent_user_frame(frame)
        parent_id = self.frame_call_ids.get(id(parent_frame)) if parent_frame else None
        call_site = self._match_call_site(parent_frame, frame)
        call_node = {
            "id": call_id,
            "parent_id": parent_id,
            "func_name": frame.f_code.co_name,
            "arguments": self._frame_arguments(frame),
            "call_step": len(self.steps),
            "return_step": None,
            "return_value": None,
            "error_step": None,
            "call_site": call_site,
        }
        self.call_tree.append(call_node)
        self._append_call_step(frame, call_id, call_site)

    def user_return(self, frame, return_value):
        if not self._is_user_frame(frame):
            return
        if id(frame) in self.exception_frames:
            self.exception_frames.discard(id(frame))
            self.frame_call_ids.pop(id(frame), None)
            return
        self._finalize_pending(frame, return_value=return_value)
        if frame.f_code.co_name == "<module>":
            return
        call_id = self.frame_call_ids.get(id(frame))
        if call_id is not None:
            for call in reversed(self.call_tree):
                if call["id"] == call_id:
                    call["return_step"] = len(self.steps)
                    call["return_value"] = encode_value(return_value)
                    break
            self._append_return_step(frame, call_id, return_value)
        self.frame_call_ids.pop(id(frame), None)

    def user_exception(self, frame, exc_info):
        if not self._is_user_frame(frame):
            return
        error = exc_info[1]
        self._finalize_pending(frame)
        self._append_error_step(frame, error)
        self.exception_frames.add(id(frame))
        call_id = self.frame_call_ids.get(id(frame))
        if call_id is not None:
            for call in reversed(self.call_tree):
                if call["id"] == call_id:
                    call["error_step"] = len(self.steps) - 1
                    break


def main():
    with open("request.json", "r", encoding="utf-8") as request_file:
        request = json.load(request_file)
    code = request["code"]
    tracer = FrameTracer(code)
    original_stdin = sys.stdin
    original_stdout = sys.stdout
    original_stderr = sys.stderr
    original_dunder_stdout = sys.__stdout__
    original_dunder_stderr = sys.__stderr__
    original_stdout_fd = os.dup(1)
    original_stderr_fd = os.dup(2)
    null_fd = os.open(os.devnull, os.O_WRONLY)
    os.dup2(null_fd, 1)
    os.dup2(null_fd, 2)
    os.close(null_fd)
    sys.stdin = io.StringIO(str(request.get("input_data", "")))
    sys.stdout = TraceOutput(tracer)
    sys.stderr = TraceOutput(tracer, capture=False)
    sys.__stdout__ = sys.stdout
    sys.__stderr__ = sys.stderr

    def traced_input(prompt=""):
        prompt_text = str(prompt)
        if prompt_text:
            sys.stdout.write(prompt_text)
        line = sys.stdin.readline()
        if line == "":
            raise EOFError("EOF when reading a line")
        value = line[:-1] if line.endswith("\n") else line
        if value.endswith("\r"):
            value = value[:-1]
        tracer.record_input(prompt_text, value)
        return value

    environment = {
        "__builtins__": __builtins__,
        "__name__": "__main__",
        "input": traced_input,
    }
    runtime_error = None
    try:
        compiled = compile(code, "user_code.py", "exec")
        tracer.runctx(compiled, environment, environment)
    except SyntaxError as error:
        tracer.append_syntax_error(error)
    except TraceLimitExceeded as error:
        runtime_error = str(error)
    except BaseException as error:
        runtime_error = f"{type(error).__name__}: {error}"
    finally:
        sys.stdin = original_stdin
        sys.stdout = original_stdout
        sys.stderr = original_stderr
        sys.__stdout__ = original_dunder_stdout
        sys.__stderr__ = original_dunder_stderr
        os.dup2(original_stdout_fd, 1)
        os.dup2(original_stderr_fd, 2)
        os.close(original_stdout_fd)
        os.close(original_stderr_fd)

    tracer.finalize_remaining()

    if not tracer.steps:
        tracer.steps.append({
            "line": 1,
            "operation": "execution",
            "statement_kind": "execution",
            "phase": "after",
            "variables": {},
            "variables_state": {},
            "output": "",
            "output_delta": "",
            "console_output": "",
            "console_delta": "",
            "description": "실행할 코드가 없습니다.",
            "func_name": "Global frame",
            "call_id": None,
            "stack_frames": [],
            "globals_vars": {},
            "globals_state": {},
            "current_blocks": [],
            "condition_result": None,
            "loop_iteration": None,
            "loop_finished": False,
            "control_state": None,
            "changes": [],
            "input_event": None,
            "call_sites": [],
        })

    payload = {
        "steps": tracer.steps,
        "code_lines": tracer.code_lines,
        "call_tree": tracer.call_tree,
        "tokens_by_line": tracer.analyzer.tokens_by_line,
        "truncated": tracer.truncated,
        "truncation_reason": runtime_error if tracer.truncated else None,
    }
    with open("trace.json", "w", encoding="utf-8") as trace_file:
        json.dump(payload, trace_file, ensure_ascii=False)


if __name__ == "__main__":
    main()
