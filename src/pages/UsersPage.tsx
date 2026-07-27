import { tint } from '../styles/colors';
import { USERS } from '../mock/users';
import { deriveUserViewModel } from '../selectors/users';

export function UsersPage() {
  const users = USERS.map(deriveUserViewModel);

  return (
    <div className="page">
      <div className="page-header">
        <div className="page-title">Users</div>
        <button type="button" className="btn--primary">
          Add User
        </button>
      </div>

      <div className="list">
        {users.map((u) => (
          <div className="list-card" key={u.name}>
            <div className="avatar">{u.initial}</div>
            <div className="list-card__col--name">
              <div className="list-card__title">{u.name}</div>
              <div className="list-card__subtitle">Last login: {u.lastLogin}</div>
            </div>
            <div className="list-card__col" style={{ flexBasis: 150 }}>
              <span className="badge" style={{ background: tint(u.roleColor, 15), color: u.roleColor }}>
                {u.role}
              </span>
            </div>
            <div className="list-card__col--wide">Access: {u.access}</div>
            <div className="list-card__actions">
              <button type="button" className="btn">
                Edit
              </button>
              <button type="button" className="btn btn--danger">
                Remove
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
