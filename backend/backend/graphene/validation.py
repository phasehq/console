from collections import Counter
from graphql import GraphQLError
from graphql.language.ast import FieldNode
from graphql.validation import ValidationRule


class DuplicateFieldLimitRule(ValidationRule):
    """Limits how many times the same response field (name or alias) can appear
    in a single selection set. Uses a Counter stack to track counts per nested
    selection set and reports an error if any exceeds MAX_DUPLICATE_FIELDS."""

    MAX_DUPLICATE_FIELDS = 20

    def __init__(self, context):
        super().__init__(context)
        self.max_duplicates = self.MAX_DUPLICATE_FIELDS
        self._stack = []  # Stack of Counters for nested selection sets

    def enter_selection_set(self, *_):
        """Push a new Counter for a nested selection set."""
        self._stack.append(Counter())

    def leave_selection_set(self, node, *_):
        """Pop Counter, emit an error for any response name exceeding limit."""
        counts = self._stack.pop()
        for response_name, hits in counts.items():
            if hits > self.max_duplicates:
                offending = [
                    selection
                    for selection in node.selections
                    if isinstance(selection, FieldNode)
                    and (
                        selection.alias.value
                        if selection.alias
                        else selection.name.value
                    )
                    == response_name
                ]
                self.context.report_error(
                    GraphQLError(
                        f"Field '{response_name}' requested {hits} times; limit is {self.max_duplicates}.",
                        nodes=offending or [node],
                    )
                )

    def enter_field(self, node, *_):
        """Increment count for this field’s response name (alias or original)."""
        response_name = node.alias.value if node.alias else node.name.value
        if not self._stack:
            self._stack.append(Counter())
        self._stack[-1][response_name] += 1


class AliasUsageLimitRule(ValidationRule):
    """Caps the number of aliases used within a single operation definition.
    Tracks alias count per operation; reports an error when exceeding
    MAX_ALIAS_FIELDS."""

    MAX_ALIAS_FIELDS = 20

    def __init__(self, context):
        super().__init__(context)
        self.max_aliases = self.MAX_ALIAS_FIELDS
        self._operation_alias_counts = (
            []
        )  # Stack for nested operations (fragments not counted)

    def enter_operation_definition(self, *_):
        """Start alias count for a new operation."""
        self._operation_alias_counts.append(0)

    def leave_operation_definition(self, *_):
        """End alias count scope for the operation."""
        self._operation_alias_counts.pop()

    def enter_field(self, node, *_):
        """Increment alias counter when a field has an alias; error if limit exceeded."""
        if node.alias:
            if not self._operation_alias_counts:
                self._operation_alias_counts.append(0)
            alias_count = self._operation_alias_counts[-1] + 1
            self._operation_alias_counts[-1] = alias_count
            if alias_count > self.max_aliases:
                self.context.report_error(
                    GraphQLError(
                        f"Alias limit of {self.max_aliases} exceeded in a single operation.",
                        nodes=[node],
                    )
                )
