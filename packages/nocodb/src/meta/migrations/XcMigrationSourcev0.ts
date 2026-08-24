import * as nc_001_init from './v0/nc_001_init';
import * as nc_002_teams from './v0/nc_002_teams';
import * as nc_003_alter_row_color_condition_nc_order_col from './v0/nc_003_alter_row_color_condition_nc_order_col';
import * as nc_004_workflows from './v0/nc_004_workflows';
import * as nc_005_add_user_specific_and_meta_column_in_sync_configs from './v0/nc_005_add_user_specific_and_meta_column_in_sync_configs';
import * as nc_006_list_view from './v0/nc_006_list_view';
import * as nc_007_timeline_view from './v0/nc_007_timeline_view';
import * as nc_008_gantt_view from './v0/nc_008_gantt_view';
import * as nc_009_gantt_dependencies from './v0/nc_009_gantt_dependencies';
import * as nc_010_record_trash from './v0/nc_010_record_trash';
import * as nc_011_base_trash_entries from './v0/nc_011_base_trash_entries';
import * as nc_012_view_trash from './v0/nc_012_view_trash';
import * as nc_013_record_trash_field_map from './v0/nc_013_record_trash_field_map';
import * as nc_014_table_trash from './v0/nc_014_table_trash';
import * as nc_015_field_trash from './v0/nc_015_field_trash';
import * as nc_016_base_snapshots from './v0/nc_016_base_snapshots';
import * as nc_017_workflow_foundation from './v0/nc_017_workflow_foundation';

// Create a custom migration source class
export default class XcMigrationSourcev0 {
  // Must return a Promise containing a list of migrations.
  // Migrations can be whatever you want, they will be passed as
  // arguments to getMigrationName and getMigration
  public getMigrations(): Promise<any> {
    // In this run we are just returning migration names
    return Promise.resolve([
      'nc_001_init',
      'nc_002_teams',
      'nc_003_alter_row_color_condition_nc_order_col',
      'nc_004_workflows',
      'nc_005_add_user_specific_and_meta_column_in_sync_configs',
      'nc_006_list_view',
      'nc_007_timeline_view',
      'nc_008_gantt_view',
      'nc_009_gantt_dependencies',
      'nc_010_record_trash',
      'nc_011_base_trash_entries',
      'nc_012_view_trash',
      'nc_013_record_trash_field_map',
      'nc_014_table_trash',
      'nc_015_field_trash',
      'nc_016_base_snapshots',
      'nc_017_workflow_foundation',
    ]);
  }

  public getMigrationName(migration): string {
    return migration;
  }

  public getMigration(migration): any {
    switch (migration) {
      case 'nc_001_init':
        return nc_001_init;
      case 'nc_002_teams':
        return nc_002_teams;
      case 'nc_003_alter_row_color_condition_nc_order_col':
        return nc_003_alter_row_color_condition_nc_order_col;
      case 'nc_004_workflows':
        return nc_004_workflows;
      case 'nc_005_add_user_specific_and_meta_column_in_sync_configs':
        return nc_005_add_user_specific_and_meta_column_in_sync_configs;
      case 'nc_006_list_view':
        return nc_006_list_view;
      case 'nc_007_timeline_view':
        return nc_007_timeline_view;
      case 'nc_008_gantt_view':
        return nc_008_gantt_view;
      case 'nc_009_gantt_dependencies':
        return nc_009_gantt_dependencies;
      case 'nc_010_record_trash':
        return nc_010_record_trash;
      case 'nc_011_base_trash_entries':
        return nc_011_base_trash_entries;
      case 'nc_012_view_trash':
        return nc_012_view_trash;
      case 'nc_013_record_trash_field_map':
        return nc_013_record_trash_field_map;
      case 'nc_014_table_trash':
        return nc_014_table_trash;
      case 'nc_015_field_trash':
        return nc_015_field_trash;
      case 'nc_016_base_snapshots':
        return nc_016_base_snapshots;
      case 'nc_017_workflow_foundation':
        return nc_017_workflow_foundation;
    }
  }
}
