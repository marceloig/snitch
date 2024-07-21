class AWSInventoryRouter:
    """
    A router to control all database operations on models in the
    steampipe.
    """

    route_app_labels = {"aws_inventory"}

    def db_for_read(self, model, **hints):
        """
        Attempts to read aws_inventory models go to steampipe.
        """
        if model._meta.app_label in self.route_app_labels:
            return "steampipe"
        return None

    def db_for_write(self, model, **hints):
        """
        Attempts to write aws_inventory models go to steampipe.
        """
        if model._meta.app_label in self.route_app_labels:
            return "steampipe"
        return None

    def allow_relation(self, obj1, obj2, **hints):
        """
        Allow relations if a model in the aws_inventory apps is
        involved.
        """
        if (
            obj1._meta.app_label in self.route_app_labels
            or obj2._meta.app_label in self.route_app_labels
        ):
            return True
        return None

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        """
        Make sure the aws_inventory apps only appear in the
        'steampipe' database.
        """
        if app_label in self.route_app_labels:
            return db == "steampipe"
        return None