from collections import Counter
from django.conf import settings
from graphql import GraphQLError
from graphql.language.ast import FieldNode
from graphql.validation import ValidationRule

MAX_DUPLICATE_FIELDS = getattr(settings, "GRAPHQL_MAX_DUPLICATE_FIELDS", 50)
MAX_ALIAS_FIELDS = getattr(settings, "GRAPHQL_MAX_ALIAS_FIELDS", 50)


class DuplicateFieldLimitRule(ValidationRule):
    def __init__(self, context):
        super().__init__(context)
        self.max_duplicates = MAX_DUPLICATE_FIELDS
        self._stack = []

    def enter_selection_set(self, *_):
        self._stack.append(Counter())

    def leave_selection_set(self, node, *_):
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
        response_name = node.alias.value if node.alias else node.name.value
        if not self._stack:
            self._stack.append(Counter())
        self._stack[-1][response_name] += 1


class AliasUsageLimitRule(ValidationRule):
    def __init__(self, context):
        super().__init__(context)
        self.max_aliases = MAX_ALIAS_FIELDS
        self._operation_alias_counts = []

    def enter_operation_definition(self, *_):
        self._operation_alias_counts.append(0)

    def leave_operation_definition(self, *_):
        self._operation_alias_counts.pop()

    def enter_field(self, node, *_):
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
